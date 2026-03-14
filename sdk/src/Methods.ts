// TODO: spec §6 requires JSON Canonicalization Scheme (JCS, RFC 8785) for the
// credential token (Authorization header) and receipt token (Payment-Receipt
// header). mppx currently uses JSON.stringify for both. The request auth-param
// in WWW-Authenticate is correctly JCS-encoded via PaymentRequest.serialize.
// Fixing requires changes to Credential.serialize and Receipt.serialize in mppx.
import { Method, z } from 'mppx'

/**
 * Lightning Network charge method — shared schema used by both server and client.
 *
 * The challenge request carries a BOLT11 invoice so the client knows exactly
 * what to pay. The credential payload carries the preimage, which the server
 * verifies with sha256(preimage) == paymentHash.
 */
export const charge = Method.from({
  intent: 'charge',
  name: 'lightning',
  schema: {
    credential: {
      payload: z.object({
        preimage: z.string(),
      }),
    },
    request: z.object({
      amount: z.string(),
      currency: z.optional(z.string()),
      description: z.optional(z.string()),
      methodDetails: z.object({
        /** Full BOLT11-encoded payment request. Authoritative source for payment parameters. */
        invoice: z.string(),
        /** SHA-256 hash of the preimage, lowercase hex. Convenience field — MUST match invoice. */
        paymentHash: z.optional(z.string()),
        /** Lightning Network identifier. Convenience field — MUST match invoice's network prefix. */
        network: z.optional(z.string()),
      }),
    }),
  },
})

/**
 * Lightning Network session method — shared schema used by both server and client.
 *
 * Implements a prepaid session model: the client deposits a lump sum upfront via
 * a BOLT11 invoice, then authenticates each subsequent request by presenting the
 * payment preimage as a bearer secret. The server tracks spent/available balances
 * in a pluggable store. On close, the server refunds unspent sats via a 0-amount
 * BOLT11 return invoice provided by the client at open time.
 *
 * Actions:
 *   open   — first request; proves deposit payment and registers return invoice
 *   bearer — ongoing requests; presents preimage as bearer token
 *   topUp  — re-deposit; proves a new invoice was paid and adds to session balance
 *   close  — end of session; triggers refund to the return invoice
 *
 * Security note on the bearer preimage:
 *   The payment preimage is a 32-byte random secret known only to the payer (the
 *   Lightning network reveals it only upon payment settlement). Using it directly
 *   as a bearer token allows the server to verify ownership with a single SHA-256
 *   check against the stored paymentHash — without ever storing the secret itself.
 *   An alternative (per-request HMAC tokens) would require the server to store the
 *   preimage, which is a worse security posture. TLS is assumed; the preimage has
 *   the same threat model as any API bearer token.
 */
export const session = Method.from({
  intent: 'session',
  name: 'lightning',
  schema: {
    credential: {
      payload: z.discriminatedUnion('action', [
        z.object({
          action: z.literal('open'),
          /** sha256-preimage proving the deposit invoice was paid. */
          preimage: z.string(),
          /** 0-amount BOLT11 invoice — server pays unspent balance to this on close. */
          returnInvoice: z.string(),
        }),
        z.object({
          action: z.literal('bearer'),
          /** paymentHash of the original deposit invoice, identifies the session. */
          sessionId: z.string(),
          /** Same preimage as open — bearer secret proving session ownership. */
          preimage: z.string(),
        }),
        z.object({
          action: z.literal('topUp'),
          /** paymentHash of the original deposit invoice, identifies the session. */
          sessionId: z.string(),
          /** Preimage of the top-up invoice — proves the top-up payment was made. */
          topUpPreimage: z.string(),
        }),
        z.object({
          action: z.literal('close'),
          /** paymentHash of the original deposit invoice, identifies the session. */
          sessionId: z.string(),
          /** Same preimage as open — bearer secret proving session ownership. */
          preimage: z.string(),
        }),
      ]),
    },
    request: z.object({
      /** Cost per unit of service in satoshis. */
      amount: z.string(),
      currency: z.string(),
      description: z.optional(z.string()),
      /** Optional label for the unit being priced (e.g., "token", "chunk"). */
      unitType: z.optional(z.string()),
      /**
       * BOLT11 deposit invoice. Present on open/topUp challenges; absent on bearer/close challenges
       * where no payment is required (spec §6 depositInvoice field).
       */
      depositInvoice: z.optional(z.string()),
      /** sha256 hash of the deposit invoice preimage. Used to verify open/topUp credentials. */
      paymentHash: z.string(),
      /**
       * Deposit amount in satoshis. Always equals the amount encoded in depositInvoice.
       * Informs the client of the exact deposit size before it inspects the invoice.
       */
      depositAmount: z.optional(z.string()),
      /**
       * Server's idle timeout policy in seconds. When present, informs the client
       * how long the server will retain an open session without activity before
       * initiating a server-side close and refund. Informational only.
       */
      idleTimeout: z.optional(z.string()),
    }),
  },
})
