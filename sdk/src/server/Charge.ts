import { SparkWallet } from '@buildonspark/spark-sdk'
import { decode as decodeBolt11 } from 'light-bolt11-decoder'
import { Method, Receipt, Store } from 'mppx'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as Methods from '../Methods.js'
import { NETWORK_MAP } from '../constants.js'

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
  const { mnemonic, network = 'mainnet', store = Store.memory() } = parameters

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
    // 402s; passes the original challenge request through on credential retry.
    async request({ credential, request }) {
      if (credential) {
        // Client is retrying with a credential — preserve the original challenge
        // so the HMAC still matches.
        return credential.challenge.request as typeof request
      }

      const wallet = await getWallet()
      const amountSats = parseInt(request.amount, 10)

      const { invoice: inv } = await wallet.createLightningInvoice({
        amountSats,
        memo: request.description ?? '',
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

    async verify({ credential }) {
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
        throw new Error('Lightning invoice has expired')
      }

      const expectedHash = credential.challenge.request.methodDetails.paymentHash
      const actualHash = bytesToHex(sha256(hexToBytes(preimage)))

      if (actualHash !== expectedHash) {
        throw new Error(`Invalid preimage: sha256(${preimage}) != ${expectedHash}`)
      }
      // TODO: spec §10.1 requires that the challenge `expires` auth-param is
      // never set later than the invoice's BOLT11 expiry. This cannot be enforced
      // here because `expires` is passed by the caller to mppx.charge() and is
      // not visible inside verify().

      // Consume-once: reject replayed preimages. Without this, a client who has
      // paid once could reuse the same preimage indefinitely (no external source
      // of truth like a blockchain enforces single-use for Lightning preimages).
      // TODO: this get-then-put is not atomic; concurrent requests with the same
      // valid preimage could both pass. Fixing requires a putIfAbsent primitive
      // on the Store interface.
      const consumedKey = `lightning-charge:consumed:${actualHash}`
      if (await store.get(consumedKey)) {
        throw new Error(`Preimage already consumed for payment: ${actualHash}`)
      }
      await store.put(consumedKey, true)

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
     * Pluggable key-value store for consumed-preimage tracking (replay prevention).
     * Defaults to in-memory. Use a persistent store (e.g. Store.cloudflare, Store.upstash)
     * in production so that consumed preimages survive server restarts.
     */
    store?: Store.Store
  }
}

