import { SparkWallet } from '@buildonspark/spark-sdk'
import { decode as decodeBolt11 } from 'light-bolt11-decoder'
import { Method, Receipt, Store } from 'mppx'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as Methods from '../Methods.js'
import { NETWORK_MAP } from '../constants.js'
import { ProblemDetailsError, ProblemType } from './problem.js'

// Share in-flight claims between methods using the same Store instance
// Cross-process exclusion requires the consumePayment callback below
const pendingPayments = new WeakMap<Store.Store, Set<string>>()

/**
 * Creates a Lightning `charge` method for usage on the server.
 *
 * Generates a fresh BOLT11 invoice for each payment challenge using the Spark
 * wallet. Verifies payment by checking that sha256(preimage) == paymentHash.
 *
 * @example
 * ```ts
 * import { Mppx, spark } from 'spark-mppx/server'
 *
 * const mppx = Mppx.create({
 *   methods: [spark.charge({ mnemonic: process.env.MNEMONIC! })],
 * })
 *
 * export async function handler(request: Request) {
 *   const result = await mppx.charge({ amount: '100', currency: 'sat' })(request)
 *   if (result.status === 402) return result.challenge
 *   return result.withReceipt(Response.json({ data: '...' }))
 * }
 * ```
 */
export function charge(parameters: charge.Parameters) {
  const { mnemonic, network = 'mainnet', store = Store.memory(), consumePayment, includeSparkInvoice = true } = parameters

  // Lazily initialize the wallet on first request so startup is synchronous.
  let walletPromise: Promise<InstanceType<typeof SparkWallet>> | null = null

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

  return Method.toServer(Methods.charge, {
    // Pre-fill dynamic fields so callers only need to provide `amount` (and
    // optionally `currency` / `description`) in mppx.charge(...).
    defaults: {
      currency: 'sat',
      methodDetails: {
        invoice: '',
        paymentHash: '',
      },
    },

    // Called on every incoming request. Generates a fresh invoice for initial
    // 402s; reuses an invoice only when the configured price still matches
    async request({ credential, request }) {
      if (credential) {
        const echoed = Methods.charge.schema.request.safeParse(credential.challenge.request)
        if (
          echoed.success &&
          echoed.data.amount === request.amount &&
          echoed.data.currency === request.currency &&
          (echoed.data.methodDetails.network ?? 'mainnet') === network
        ) {
          // Keep route options authoritative. mppx compares this request with
          // the echo after authenticating the challenge's HMAC
          return { ...request, methodDetails: echoed.data.methodDetails }
        }
      }

      const wallet = await getWallet()
      const amountSats = parseInt(request.amount, 10)

      const { invoice: inv } = await wallet.createLightningInvoice({
        amountSats,
        memo: request.description ?? '',
        includeSparkInvoice,
      })

      return {
        ...request,
        methodDetails: {
          invoice: inv.encodedInvoice,
          paymentHash: inv.paymentHash,
          network,
        },
      }
    },

    async verify({ credential, request }) {
      const echoed = credential.challenge.request
      if (
        echoed.amount !== request.amount ||
        echoed.currency !== request.currency ||
        (echoed.methodDetails.network ?? 'mainnet') !== network
      ) {
        throw new ProblemDetailsError({
          type: ProblemType.InvalidChallenge,
          title: 'Invalid Challenge',
          status: 400,
          detail: 'Payment challenge does not match the requested amount, currency, or network',
        })
      }
      const preimage = credential.payload.preimage
      // TODO: spec §9 requires looking up the stored challenge by
      // credential.challenge.id and reading paymentHash from the server-recorded
      // value, not from the client-echoed request. With HMAC-bound challenge IDs
      // the client cannot tamper with this field, so the attack vector is closed,
      // but this is not spec-literal.
      // TODO: errors thrown here should be RFC 9457 Problem Details responses
      // (application/problem+json) with type URIs from
      // https://paymentauth.org/problems/. Currently surfaced as generic mppx
      // errors. Fixing requires changes to the mppx transport layer.

      // Verify the invoice has not expired (spec §12.3) before doing any
      // preimage arithmetic, so expired-invoice probes get no oracle signal.
      const invoice = credential.challenge.request.methodDetails.invoice
      const decoded = decodeBolt11(invoice)
      const timestampSection = decoded.sections.find((s) => s.name === 'timestamp') as
        | { name: 'timestamp'; value: number }
        | undefined
      const invoiceExpiresAt = ((timestampSection?.value ?? 0) + decoded.expiry) * 1000
      if (Date.now() > invoiceExpiresAt) {
        throw new ProblemDetailsError({
          type: ProblemType.InvoiceExpired,
          title: 'Invoice Expired',
          status: 422,
          detail: 'Lightning invoice has expired',
        })
      }

      const expectedHash = credential.challenge.request.methodDetails.paymentHash
      if (!/^[0-9a-f]{64}$/i.test(preimage)) {
        throw new ProblemDetailsError({
          type: ProblemType.InvalidPreimage,
          title: 'Invalid Preimage',
          status: 400,
          detail: 'Preimage must be 32 bytes encoded as hex',
        })
      }
      const actualHash = bytesToHex(sha256(hexToBytes(preimage)))

      if (actualHash !== expectedHash) {
        throw new ProblemDetailsError({
          type: ProblemType.InvalidPreimage,
          title: 'Invalid Preimage',
          status: 400,
          detail: 'Preimage does not match the invoice payment hash',
        })
      }
      // TODO: spec §10.1 requires that the challenge `expires` auth-param is
      // never set later than the invoice's BOLT11 expiry. This cannot be enforced
      // here because `expires` is passed by the caller to mppx.charge() and is
      // not visible inside verify().

      // Consume-once: reject replayed preimages. Without this, a client who has
      // paid once could reuse the same preimage indefinitely (no external source
      // of truth like a blockchain enforces single-use for Lightning preimages).
      // A production callback must atomically and durably claim the hash
      // Never release a claim after verification or resource delivery fails
      const consumed = consumePayment
        ? await consumePayment(actualHash)
        : await consumeFromStore(store, actualHash)
      if (consumed !== true) {
        throw new ProblemDetailsError({
          type: ProblemType.PreimageConsumed,
          title: 'Preimage Already Consumed',
          status: 409,
          detail: `Preimage already consumed for payment: ${actualHash}`,
        })
      }

      // Use the payment hash as the receipt reference, not the preimage.
      // The preimage is a bearer secret and MUST NOT appear in receipts/logs.
      return Receipt.from({
        method: 'lightning',
        reference: actualHash,
        status: 'success',
        timestamp: new Date().toISOString(),
      })
    },
  })
}

export declare namespace charge {
  type Parameters = {
    /** BIP39 mnemonic for the receiving Spark wallet. */
    mnemonic: string
    /** Lightning network. Defaults to 'mainnet'. */
    network?: 'mainnet' | 'regtest' | 'signet'
    /**
     * Pluggable key-value store for consumed-preimage tracking (replay prevention)
     * Defaults to in-memory and is safe for concurrent requests sharing the same
     * Store object in one process. Persistence alone does not make get/put atomic
     * across replicas; use consumePayment for distributed deployments
     * Ignored when consumePayment is provided
     */
    store?: Store.Store
    /**
     * Atomically consume a verified payment hash in shared, persistent storage
     * Return true only after a durable first claim, false if already consumed,
     * and throw on storage failure. For example, use a unique database insert
     * or Redis SET NX. Retain claims for at least as long as proofs are valid
     * Called only after verification, with the payment hash, never the preimage
     * Required for replay protection across replicas and process restarts
     */
    consumePayment?: (paymentHash: string) => Promise<boolean>
    /**
     * Whether to include a Spark invoice alongside the BOLT11 invoice.
     * Defaults to `true`. Set to `false` to disable Spark invoice generation.
     * See https://docs.spark.money/api-reference/wallet/create-lightning-invoice#param-include-spark-invoice
     */
    includeSparkInvoice?: boolean
  }
}

/** Serialize get/put for a payment within one process, including shared stores */
async function consumeFromStore(store: Store.Store, paymentHash: string): Promise<boolean> {
  let pending = pendingPayments.get(store)
  if (!pending) {
    pending = new Set()
    pendingPayments.set(store, pending)
  }
  const key = `lightning-charge:consumed:${paymentHash}`
  if (pending.has(key)) return false
  pending.add(key)
  try {
    if (await store.get(key)) return false
    await store.put(key, true)
    return true
  } finally {
    pending.delete(key)
  }
}

