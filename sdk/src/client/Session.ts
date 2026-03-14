import { SparkWallet } from '@buildonspark/spark-sdk'
import { Credential, Method } from 'mppx'
import * as Methods from '../Methods.js'
import { NETWORK_MAP, WalletLike, resolvePreimage } from './utils.js'

// ---------------------------------------------------------------------------
// Client-side session state (in-memory per method instance)
// ---------------------------------------------------------------------------

type ActiveSession = {
  /** paymentHash of the deposit invoice — the session identifier. */
  sessionId: string
  /** Preimage of the deposit invoice — bearer secret for all session requests. */
  preimage: string
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Creates a Lightning `session` method for usage on the client.
 *
 * Intercepts 402 responses and handles the full session lifecycle automatically:
 *   - On the first 402, pays the deposit invoice and opens a session.
 *   - On subsequent 402s, presents the preimage as a bearer token (no payment).
 *   - Call `method.close(fetch, url)` to close the session and trigger a refund.
 *   - Call `method.cleanup()` when done to close Spark websocket connections.
 *
 * Pass either `mnemonic` (SDK creates and owns the wallet) or `wallet` (use an
 * already-initialized wallet — useful when the caller manages wallet lifecycle
 * for other purposes such as balance queries).
 *
 * @example
 * ```ts
 * import { Mppx, spark } from 'spark-mppx/client'
 *
 * const method = spark.session({ mnemonic: process.env.MNEMONIC!, network: 'regtest' })
 * const mppx = Mppx.create({ methods: [method] })
 *
 * const response = await mppx.fetch('https://api.example.com/endpoint')
 * console.log(await response.json())
 *
 * await method.close(mppx.fetch, 'https://api.example.com/endpoint')
 * await method.cleanup()
 * ```
 */
export function session(parameters: session.Parameters) {
  const { maxFeeSats = 100, onProgress } = parameters

  let walletPromise: Promise<WalletLike> | null = null
  let activeSession: ActiveSession | null = null
  let pendingClose = false
  let pendingTopUp = false

  function getWallet(): Promise<WalletLike> {
    if (parameters.wallet !== undefined) {
      return Promise.resolve(parameters.wallet)
    }
    if (!walletPromise) {
      const { mnemonic, network = 'mainnet' } = parameters as { mnemonic: string; network?: keyof typeof NETWORK_MAP }
      walletPromise = SparkWallet.initialize({
        mnemonicOrSeed: mnemonic,
        options: { network: NETWORK_MAP[network] },
      }).then(({ wallet }) => wallet)
        .catch((e) => { walletPromise = null; throw e })
    }
    return walletPromise!
  }

  const method = Method.toClient(Methods.session, {
    async createCredential({ challenge }) {
      const wallet = await getWallet()
      const { amount, depositAmount, depositInvoice, paymentHash } = challenge.request

      // Top-up action — pay new deposit invoice and add to session balance.
      if (activeSession && pendingTopUp) {
        pendingTopUp = false
        const topUpSats = parseInt((depositAmount ?? '0') as string, 10)
        onProgress?.({ type: 'topping-up', topUpSats })
        const topUpResult = await wallet.payLightningInvoice({
          invoice: depositInvoice as string,
          maxFeeSats,
        })
        const topUpPreimage = await resolvePreimage(wallet, topUpResult)
        onProgress?.({ type: 'topped-up', topUpSats })
        return Credential.serialize({
          challenge,
          payload: {
            action: 'topUp',
            sessionId: activeSession.sessionId,
            topUpPreimage,
          },
        })
      }

      // Close action — send close credential and clear the session.
      if (activeSession && pendingClose) {
        const { sessionId, preimage } = activeSession
        pendingClose = false
        activeSession = null
        return Credential.serialize({
          challenge,
          payload: { action: 'close', sessionId, preimage },
        })
      }

      // Ongoing session — present preimage as bearer token (no payment required).
      if (activeSession) {
        onProgress?.({ type: 'bearer', amount: parseInt(amount, 10) })
        return Credential.serialize({
          challenge,
          payload: {
            action: 'bearer',
            sessionId: activeSession.sessionId,
            preimage: activeSession.preimage,
          },
        })
      }

      // New session — pay the deposit invoice and create a 0-amount return invoice
      // for the server to refund unspent balance when the session closes.
      const depositSats = parseInt((depositAmount ?? '0') as string, 10)
      onProgress?.({ type: 'opening', depositSats, amount: parseInt(amount, 10) })

      const [result, returnInvoiceResult] = await Promise.all([
        wallet.payLightningInvoice({
          invoice: depositInvoice as string,
          maxFeeSats,
        }),
        wallet.createLightningInvoice({
          amountSats: 0,
          memo: 'Session refund',
          expirySeconds: 60 * 60 * 24 * 30, // 30 days
        }),
      ])

      const preimage = await resolvePreimage(wallet, result)
      const sessionId = paymentHash as string
      const returnInvoice = returnInvoiceResult.invoice.encodedInvoice

      activeSession = { sessionId, preimage }

      return Credential.serialize({
        challenge,
        payload: {
          action: 'open',
          preimage,
          returnInvoice,
        },
      })
    },
  })

  /**
   * Tops up the active session by paying a new deposit invoice from the server.
   * Use this when the session balance is exhausted but you want to continue.
   *
   * @param fetch - mppx-wrapped fetch (pass `mppx.fetch`).
   * @param url   - Any protected endpoint URL on the same server.
   */
  async function topUp(
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    url: string,
  ): Promise<Response> {
    if (!activeSession) throw new Error('No active session to top up')
    pendingTopUp = true
    try {
      return await fetch(url)
    } catch (err) {
      pendingTopUp = false
      throw err
    }
  }

  /**
   * Closes the active session, triggering a refund from the server for any
   * unspent balance. The refund is paid to the return invoice the client
   * submitted when opening the session.
   *
   * Internally sets a flag so the next call to `createCredential` (triggered by
   * the 402 from `fetch`) emits a close credential instead of a voucher.
   *
   * @param fetch - mppx-wrapped fetch (pass `mppx.fetch`).
   * @param url   - Any protected endpoint URL on the same server.
   */
  async function close(
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    url: string,
  ): Promise<Response> {
    if (!activeSession) throw new Error('No active session to close')
    pendingClose = true
    try {
      return await fetch(url)
    } catch (err) {
      pendingClose = false
      throw err
    }
  }

  /**
   * Closes open Spark websocket connections. Only effective when the SDK owns
   * the wallet (i.e. `mnemonic` was passed rather than `wallet`). Call when
   * done to allow the process to exit.
   */
  async function cleanup() {
    if (parameters.wallet === undefined && walletPromise) {
      const wallet = await walletPromise
      await wallet.cleanupConnections()
    }
  }

  /** Returns the active session ID, or null if no session is open. */
  function getSession(): Pick<ActiveSession, 'sessionId'> | null {
    return activeSession ? { sessionId: activeSession.sessionId } : null
  }

  /**
   * Clears the local session state without sending a close credential to the
   * server. Use this when the server has already closed the session (e.g. due
   * to an idle timeout) and a subsequent bearer request was rejected. After
   * calling this, the next `mppx.fetch()` will open a fresh session.
   */
  function resetSession(): void {
    activeSession = null
    pendingClose = false
    pendingTopUp = false
  }

  return Object.assign(method, { close, topUp, cleanup, getSession, resetSession })
}

export declare namespace session {
  /** Pass either `mnemonic` (SDK manages the wallet) or `wallet` (caller-managed). */
  type Parameters = {
    network?: 'mainnet' | 'regtest' | 'signet'
    maxFeeSats?: number
    /** Called at each step of the session lifecycle. Optional. */
    onProgress?: (event: ProgressEvent) => void
  } & (
    | { mnemonic: string; wallet?: undefined }
    | { wallet: WalletLike; mnemonic?: undefined }
  )

  type ProgressEvent =
    /** A new session is being opened; deposit payment is about to be made. */
    | { type: 'opening'; depositSats: number; amount: number }
    /** An existing session is being resumed via bearer token (no payment). */
    | { type: 'bearer'; amount: number }
    /** Top-up payment is about to be made. */
    | { type: 'topping-up'; topUpSats: number }
    /** Top-up payment confirmed. */
    | { type: 'topped-up'; topUpSats: number }
}
