import { SparkWallet } from '@buildonspark/spark-sdk'
import { decode as decodeBolt11 } from 'light-bolt11-decoder'
import { Credential, Method, Receipt, Store } from 'mppx'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as Methods from '../Methods.js'
import { NETWORK_MAP } from '../constants.js'
import { ProblemDetailsError, ProblemType } from './problem.js'

// ---------------------------------------------------------------------------
// Session state (persisted in the pluggable store)
// ---------------------------------------------------------------------------

type SessionState = {
  /** sha256 payment hash of the deposit invoice — also the session ID. */
  paymentHash: string
  /** Total satoshis deposited. */
  depositSats: number
  /** Running total charged against this session. */
  spent: number
  /** 0-amount BOLT11 return invoice — server pays unspent balance to this on close. */
  returnInvoice: string
  /** 'open' until a close action is processed. */
  status: 'open' | 'closed'
  /** Refund amount in satoshis. Set after session is closed. */
  refundSats?: number
  /** Refund payment outcome. Set after close attempt. */
  refundStatus?: 'succeeded' | 'failed' | 'skipped'
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Creates a Lightning `session` method for usage on the server.
 *
 * Clients deposit a lump sum upfront via a BOLT11 invoice, then authenticate
 * each request by presenting the preimage as a bearer secret. Per-request cost
 * is deducted from the session balance. On close the server refunds any unspent
 * sats via a direct Spark transfer.
 *
 * @example
 * ```ts
 * import { Mppx, spark } from 'spark-mppx/server'
 *
 * const mppx = Mppx.create({
 *   methods: [spark.session({ mnemonic: process.env.MNEMONIC! })],
 * })
 *
 * export async function handler(request: Request) {
 *   const result = await mppx.session({ amount: '10', currency: 'sat' })(request)
 *   if (result.status === 402) return result.challenge
 *   return result.withReceipt(Response.json({ data: '...' }))
 * }
 * ```
 */
export function session(parameters: session.Parameters) {
  const {
    mnemonic,
    network = 'mainnet',
    store = Store.memory(),
    unitType,
    depositAmount: configuredDepositAmount,
    idleTimeout: idleTimeoutSecs = 300,
  } = parameters

  const idleTimeoutMs = idleTimeoutSecs > 0 ? idleTimeoutSecs * 1000 : 0

  let walletPromise: Promise<InstanceType<typeof SparkWallet>> | null = null

  // Per-session waiters for top-up notifications. When deduct() returns false
  // (insufficient balance), the streaming handler calls waitForTopUp() which
  // parks a promise here. When a topUp credential is verified, notify() resolves
  // all waiters for that session so the stream can resume without closing.
  const waiters = new Map<string, Set<() => void>>()

  // Per-session idle timers. Each timer fires after idleTimeoutMs of inactivity
  // and calls closeSession() to refund unspent balance and mark the session closed.
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function notify(sessionId: string): void {
    const set = waiters.get(sessionId)
    if (!set) return
    for (const resolve of set) resolve()
    waiters.delete(sessionId)
  }

  function clearIdleTimer(sessionId: string): void {
    const timer = idleTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      idleTimers.delete(sessionId)
    }
  }

  function resetIdleTimer(sessionId: string): void {
    if (!idleTimeoutMs) return
    clearIdleTimer(sessionId)
    const timer = setTimeout(async () => {
      idleTimers.delete(sessionId)
      await closeSession(sessionId)
    }, idleTimeoutMs)
    idleTimers.set(sessionId, timer)
  }

  /**
   * Closes an open session and attempts to refund the unspent balance.
   * Safe to call for both client-initiated and server-initiated closes.
   * Marks the session closed atomically before attempting payment so that
   * concurrent bearer requests are rejected immediately.
   */
  async function closeSession(sessionId: string): Promise<void> {
    const state = await store.get<SessionState>(storeKey(sessionId))
    if (!state || state.status !== 'open') return

    const refundSats = Math.max(state.depositSats - state.spent, 0)
    // Mark closed atomically before attempting refund so concurrent bearer
    // requests are rejected immediately (spec §server-initiated-close).
    const closedState: SessionState = { ...state, status: 'closed' }
    await store.put(storeKey(sessionId), closedState)

    let refundStatus: 'succeeded' | 'failed' | 'skipped'
    if (refundSats > 0) {
      try {
        const wallet = await getWallet()
        await wallet.payLightningInvoice({
          invoice: state.returnInvoice,
          maxFeeSats: 100,
          amountSatsToSend: refundSats,
        })
        refundStatus = 'succeeded'
      } catch (err) {
        console.error(
          `[spark-session] refund failed for session ${sessionId}: ${refundSats} sats owed`,
          err,
        )
        refundStatus = 'failed'
      }
    } else {
      refundStatus = 'skipped'
    }

    // Store refund outcome so the respond() hook can include it in the response body.
    await store.put(storeKey(sessionId), { ...closedState, refundSats, refundStatus })
  }

  function getWallet() {
    if (!walletPromise) {
      walletPromise = SparkWallet.initialize({
        mnemonicOrSeed: mnemonic,
        options: { network: NETWORK_MAP[network] },
      }).then(({ wallet }) => wallet)
        .catch((e) => { walletPromise = null; throw e })
    }
    return walletPromise
  }

  /**
   * Attempts to deduct `sats` from the active session balance.
   *
   * Returns `true` if the deduction succeeded, or `false` if the session has
   * insufficient balance. Throws if the session is not found or already closed.
   *
   * Use inside a streaming response for per-chunk billing. When this returns
   * `false`, emit a `payment-need-topup` SSE event and call `waitForTopUp()`
   * to pause the stream until the client tops up.
   */
  async function deduct(sessionId: string, sats: number): Promise<boolean> {
    const state = await store.get<SessionState>(storeKey(sessionId))
    if (!state) throw new ProblemDetailsError({
      type: ProblemType.SessionNotFound,
      title: 'Session Not Found',
      status: 404,
      detail: `Session not found: ${sessionId}`,
    })
    if (state.status !== 'open') throw new ProblemDetailsError({
          type: ProblemType.SessionClosed,
          title: 'Session Closed',
          status: 409,
          detail: `Session is already closed`,
        })
    const available = state.depositSats - state.spent
    if (available < sats) return false
    await store.put(storeKey(sessionId), { ...state, spent: state.spent + sats })
    resetIdleTimer(sessionId)
    return true
  }

  /**
   * Waits for the next top-up on a session.
   *
   * Parks until a `topUp` credential is verified for `sessionId` (which calls
   * `notify()`) or `timeoutMs` elapses. Returns `true` if a top-up arrived,
   * `false` on timeout. Use after `deduct()` returns `false` to hold a stream
   * open instead of closing and forcing the client to reconnect.
   */
  function waitForTopUp(sessionId: string, timeoutMs = 60_000): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const onUpdate = () => {
        clearTimeout(timer)
        resolve(true)
      }

      const timer = setTimeout(() => {
        const set = waiters.get(sessionId)
        if (set) {
          set.delete(onUpdate)
          if (set.size === 0) waiters.delete(sessionId)
        }
        resolve(false)
      }, timeoutMs)

      let set = waiters.get(sessionId)
      if (!set) {
        set = new Set()
        waiters.set(sessionId, set)
      }
      set.add(onUpdate)
    })
  }

  const method = Method.toServer(Methods.session, {
    defaults: {
      currency: 'sat',
      paymentHash: '',
    },

    // Called on every incoming request. Generates a fresh deposit invoice for
    // unauthenticated requests; preserves the existing challenge on retries.
    async request({ credential, request }) {
      if (credential) {
        return credential.challenge.request as typeof request
      }

      const wallet = await getWallet()
      const pricePerUnit = parseInt(request.amount, 10)
      const depositSats = configuredDepositAmount ?? pricePerUnit * 20

      const { invoice } = await wallet.createLightningInvoice({
        amountSats: depositSats,
        memo: request.description ?? 'Session deposit',
      })

      return {
        ...request,
        depositInvoice: invoice.encodedInvoice,
        paymentHash: invoice.paymentHash,
        depositAmount: String(depositSats),
        ...(unitType !== undefined && { unitType }),
        ...(idleTimeoutMs > 0 && { idleTimeout: String(idleTimeoutSecs) }),
      }
    },

    async verify({ credential, request }) {
      const { payload } = credential

      if (payload.action === 'open') {
        // TODO: spec §10.1 requires looking up the stored challenge by
        // credential.challenge.id and reading paymentHash from the server-recorded
        // value. HMAC binding prevents the client from tampering, but this is not
        // spec-literal. Same issue applies to topUp verification below.
        // TODO: errors thrown here should be RFC 9457 Problem Details responses.
        // See server/Charge.ts for the same note.
        // Verify the preimage matches the deposit invoice payment hash.
        const actualHash = bytesToHex(sha256(hexToBytes(payload.preimage)))
        if (actualHash !== request.paymentHash) {
          throw new ProblemDetailsError({
            type: ProblemType.InvalidPreimage,
            title: 'Invalid Preimage',
            status: 400,
            detail: `Invalid preimage for open: sha256(${payload.preimage}) !== ${request.paymentHash}`,
          })
        }

        if (!request.depositInvoice) {
          throw new ProblemDetailsError({
          type: ProblemType.SessionNotFound,
          title: 'Missing Deposit Invoice',
          status: 422,
          detail: 'Missing depositInvoice in challenge request for open action',
        })
        }
        const depositSats = resolveInvoiceAmount(request.depositInvoice)
        const sessionId = request.paymentHash
        const pricePerUnit = parseInt(request.amount, 10)

        // Consume-once: prevent replay of the open credential, which would
        // reset session.spent to 0 (balance reset attack).
        // TODO: not atomic — see charge TODO for the same caveat.
        const openConsumedKey = `lightning-session:consumed:${sessionId}`
        if (await store.get(openConsumedKey)) {
          throw new ProblemDetailsError({
          type: ProblemType.DepositConsumed,
          title: 'Deposit Already Consumed',
          status: 409,
          detail: `Deposit invoice already consumed for session: ${sessionId}`,
        })
        }
        await store.put(openConsumedKey, true)

        if (depositSats < pricePerUnit) {
          throw new ProblemDetailsError({
            type: ProblemType.InsufficientDeposit,
            title: 'Insufficient Deposit',
            status: 402,
            detail: `Deposit (${depositSats} sat) is less than cost per request (${pricePerUnit} sat)`,
          })
        }

        // Return invoice must encode 0 sats (used as a refund address; the
        // actual refund amount is determined by the server at close time).
        const returnAmount = resolveInvoiceAmount(payload.returnInvoice)
        if (returnAmount !== 0) {
          throw new ProblemDetailsError({
          type: ProblemType.InvalidReturnInvoice,
          title: 'Invalid Return Invoice',
          status: 422,
          detail: `returnInvoice must not encode an amount (found ${returnAmount} sat)`,
        })
        }

        const state: SessionState = {
          paymentHash: sessionId,
          depositSats,
          spent: 0,
          returnInvoice: payload.returnInvoice,
          status: 'open',
        }
        await store.put(storeKey(sessionId), state)
        resetIdleTimer(sessionId)

        return Receipt.from({
          method: 'lightning',
          reference: sessionId,
          status: 'success',
          timestamp: new Date().toISOString(),
        })
      }

      if (payload.action === 'bearer') {
        const state = await store.get<SessionState>(storeKey(payload.sessionId))
        if (!state) throw new ProblemDetailsError({
          type: ProblemType.SessionNotFound,
          title: 'Session Not Found',
          status: 404,
          detail: `Session not found: ${payload.sessionId}`,
        })
        if (state.status !== 'open') throw new ProblemDetailsError({
          type: ProblemType.SessionClosed,
          title: 'Session Closed',
          status: 409,
          detail: `Session is already closed`,
        })

        assertPreimage(payload.preimage, state.paymentHash)
        resetIdleTimer(payload.sessionId)

        return Receipt.from({
          method: 'lightning',
          reference: payload.sessionId,
          status: 'success',
          timestamp: new Date().toISOString(),
        })
      }

      if (payload.action === 'topUp') {
        const state = await store.get<SessionState>(storeKey(payload.sessionId))
        if (!state) throw new ProblemDetailsError({
          type: ProblemType.SessionNotFound,
          title: 'Session Not Found',
          status: 404,
          detail: `Session not found: ${payload.sessionId}`,
        })
        if (state.status !== 'open') throw new ProblemDetailsError({
          type: ProblemType.SessionClosed,
          title: 'Session Closed',
          status: 409,
          detail: `Session is already closed`,
        })

        // Verify the top-up preimage matches the current challenge's invoice.
        const actualHash = bytesToHex(sha256(hexToBytes(payload.topUpPreimage)))
        if (actualHash !== request.paymentHash) {
          throw new ProblemDetailsError({
            type: ProblemType.InvalidPreimage,
            title: 'Invalid Top-Up Preimage',
            status: 400,
            detail: `Invalid top-up preimage: sha256(${payload.topUpPreimage}) !== ${request.paymentHash}`,
          })
        }

        if (!request.depositInvoice) {
          throw new ProblemDetailsError({
            type: ProblemType.SessionNotFound,
            title: 'Missing Deposit Invoice',
            status: 422,
            detail: 'Missing depositInvoice in challenge request for topUp action',
          })
        }
        const topUpSats = resolveInvoiceAmount(request.depositInvoice)

        // Consume-once: prevent double-crediting the same top-up invoice.
        // TODO: not atomic — see charge TODO for the same caveat.
        const topUpConsumedKey = `lightning-session:consumed:${request.paymentHash}`
        if (await store.get(topUpConsumedKey)) {
          throw new ProblemDetailsError({
            type: ProblemType.DepositConsumed,
            title: 'Top-Up Invoice Already Consumed',
            status: 409,
            detail: `Top-up invoice already consumed`,
          })
        }
        await store.put(topUpConsumedKey, true)

        await store.put(storeKey(payload.sessionId), {
          ...state,
          depositSats: state.depositSats + topUpSats,
        })

        // Wake any streaming handlers waiting for balance on this session.
        notify(payload.sessionId)
        resetIdleTimer(payload.sessionId)

        return Receipt.from({
          method: 'lightning',
          reference: payload.sessionId,
          status: 'success',
          timestamp: new Date().toISOString(),
        })
      }

      if (payload.action === 'close') {
        const state = await store.get<SessionState>(storeKey(payload.sessionId))
        if (!state) throw new ProblemDetailsError({
          type: ProblemType.SessionNotFound,
          title: 'Session Not Found',
          status: 404,
          detail: `Session not found: ${payload.sessionId}`,
        })
        if (state.status !== 'open') throw new ProblemDetailsError({
          type: ProblemType.SessionClosed,
          title: 'Session Closed',
          status: 409,
          detail: `Session is already closed`,
        })

        assertPreimage(payload.preimage, state.paymentHash)
        clearIdleTimer(payload.sessionId)
        await closeSession(payload.sessionId)

        // TODO: spec §15 specifies Payment-Receipt only for actions other than
        // close. The close response body {"status":"closed","refundSats":N} is
        // correct, but mppx will also attach a Payment-Receipt header because
        // verify() must return a Receipt. Suppressing it requires mppx changes.
        // TODO: spec §11 requires idempotency: a retried credential after a
        // network failure must return the cached original response rather than
        // re-executing the action. Implementing this requires storing responses
        // keyed by challenge.id with TTL — deferred.
        return Receipt.from({
          method: 'lightning',
          reference: payload.sessionId,
          status: 'success',
          timestamp: new Date().toISOString(),
        })
      }

      throw new ProblemDetailsError({
      type: ProblemType.UnknownAction,
      title: 'Unknown Action',
      status: 400,
      detail: 'Unknown session action',
    })
    },

    async respond({ credential }) {
      // topUp: short-circuit the user handler — the stream resumes on the
      // original connection via notify(); no new stream should be started.
      if (credential.payload.action === 'topUp') {
        return Response.json({ status: 'ok' })
      }

      // close: return the refund summary directly (spec §close-action).
      if (credential.payload.action === 'close') {
        const state = await store.get<SessionState>(storeKey(credential.payload.sessionId))
        const refundSats = state?.refundSats ?? Math.max((state?.depositSats ?? 0) - (state?.spent ?? 0), 0)
        const refundStatus = state?.refundStatus ?? 'skipped'
        return Response.json({ status: 'closed', refundSats, refundStatus })
      }
    },
  })

  /**
   * Serves a metered SSE stream, handling per-chunk billing automatically.
   *
   * Reads the per-chunk cost and session ID directly from the request credential,
   * so `amount` in `mppx.session()` is the single source of truth for billing.
   * For each value yielded by `generate`, deducts `amount` sats from the session
   * balance and emits a `data:` SSE event. When the balance is exhausted, emits
   * a `payment-need-topup` event and holds the connection open until the client
   * tops up or `timeoutMs` elapses.
   *
   * @example
   * ```ts
   * const result = await mppx.session({ amount: '2', currency: 'sat' })(request)
   * if (result.status === 402) return result.challenge
   * const cred = Credential.fromRequest<{ action: string }>(request)
   * if (cred.payload.action === 'topUp' || cred.payload.action === 'close') {
   *   return result.withReceipt()
   * }
   * return result.withReceipt(
   *   sessionMethod.serve({ request, generate: myAsyncGenerator() })
   * )
   * ```
   */
  function serve(options: session.serve.Options): Response {
    const { request, generate, timeoutMs = 60_000 } = options

    const cred = Credential.fromRequest<{ action: string; sessionId?: string }>(request)
    const challengeRequest = cred.challenge.request as Record<string, unknown>
    const satsPerChunk = parseInt(challengeRequest.amount as string, 10)
    const sessionId =
      'sessionId' in cred.payload
        ? (cred.payload.sessionId as string)
        : (challengeRequest.paymentHash as string)
    const enc = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Read the session's already-spent amount so balanceSpent in the
        // payment-need-topup event reflects total session spend, not just this stream.
        const initialState = await store.get<SessionState>(storeKey(sessionId))
        const sessionSpentBefore = initialState?.spent ?? 0
        let spent = 0
        try {
          let units = 0
          for await (const value of generate) {
            while (!(await deduct(sessionId, satsPerChunk))) {
              controller.enqueue(
                enc.encode(
                  `event: payment-need-topup\ndata: ${JSON.stringify({ sessionId, balanceRequired: satsPerChunk, balanceSpent: sessionSpentBefore + spent })}\n\n`,
                ),
              )
              const resumed = await waitForTopUp(sessionId, timeoutMs)
              if (!resumed) {
                // Balance did not recover within timeout — emit session-timeout
                // before closing the connection (spec §session-timeout-event).
                controller.enqueue(
                  enc.encode(
                    `event: session-timeout\ndata: ${JSON.stringify({ sessionId, balanceSpent: sessionSpentBefore + spent, balanceRequired: satsPerChunk })}\n\n`,
                  ),
                )
                return
              }
            }
            spent += satsPerChunk
            units++
            controller.enqueue(enc.encode(`data: ${value}\n\n`))
          }
          controller.enqueue(
            enc.encode(
              `event: payment-receipt\ndata: ${JSON.stringify({ method: 'lightning', reference: sessionId, status: 'success', timestamp: new Date().toISOString(), spent, units })}\n\n`,
            ),
          )
          controller.enqueue(enc.encode(`data: [DONE]\n\n`))
        } catch (err) {
          controller.error(err)
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  }

  return Object.assign(method, { deduct, waitForTopUp, serve })
}

export declare namespace session {
  namespace serve {
    type Options = {
      /**
       * The original HTTP request. Used to extract the session ID and per-chunk
       * cost (from the echoed challenge's `amount` field) automatically.
       */
      request: Request
      /** Async iterable of SSE data payloads (one string per chunk). */
      generate: AsyncIterable<string>
      /**
       * Milliseconds to hold the connection open waiting for a top-up.
       * Defaults to 60 000 (60 seconds).
       */
      timeoutMs?: number
    }
  }
  type Parameters = {
    /** BIP39 mnemonic for the receiving Spark wallet. */
    mnemonic: string
    /** Lightning network. Defaults to 'mainnet'. */
    network?: 'mainnet' | 'regtest' | 'signet'
    /**
     * Exact deposit amount in satoshis. Sent to the client in the challenge so
     * it can display the deposit size before inspecting the invoice. When not
     * set, defaults to 20× the per-chunk `amount`.
     */
    depositAmount?: number
    /**
     * Optional label for the unit being priced (e.g., "token", "chunk").
     * Forwarded to the client in the challenge request as `unitType`.
     */
    unitType?: string
    /** Pluggable key-value store for session state. Defaults to in-memory. */
    store?: Store.Store
    /**
     * Idle timeout in seconds. Sessions with no bearer or topUp activity for
     * this duration are automatically closed and the unspent balance refunded
     * to the client's return invoice. Defaults to 300 (5 minutes). Set to 0
     * to disable idle timeouts.
     */
    idleTimeout?: number
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function storeKey(sessionId: string): string {
  return `lightning-session:${sessionId}`
}

function assertPreimage(preimage: string, expectedHash: string): void {
  const actualHash = bytesToHex(sha256(hexToBytes(preimage)))
  if (actualHash !== expectedHash) {
    throw new ProblemDetailsError({
      type: ProblemType.InvalidPreimage,
      title: 'Invalid Session Credential',
      status: 400,
      detail: `Invalid session credential: preimage does not match session`,
    })
  }
}

/**
 * Extracts the amount in satoshis encoded in a BOLT11 invoice using
 * light-bolt11-decoder. Returns 0 for 0-amount (amountless) invoices.
 */
function resolveInvoiceAmount(invoice: string): number {
  const decoded = decodeBolt11(invoice)
  const section = decoded.sections.find((s) => s.name === 'amount') as
    | { name: 'amount'; letters: string; value: string }
    | undefined
  if (!section?.value) return 0
  // section.value is millisatoshis; integer-divide to satoshis.
  return Number(BigInt(section.value) / 1000n)
}
