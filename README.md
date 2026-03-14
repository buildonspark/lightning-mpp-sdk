<p align="center">
  <img src="./assets/banner.png" alt="spark-mppx" width="800">
</p>

# lightning-mppx

A Lightning Network payment method for [MPP](https://mpp.dev).

[MPP](https://mpp.dev) (Machine Payments Protocol) is an open protocol that lets any HTTP API accept payments using the standard `402 Payment Required` flow. `spark-mppx` extends the [`mppx`](https://github.com/tempoxyz/mpp) SDK with Lightning Network support via [Spark](https://spark.money), sitting alongside built-in methods like [Stripe](https://stripe.com) and [Tempo](https://tempo.xyz).

The protocol supports two intents — **charge** for one-time payments and **session** for prepaid metered access — defined in implementation-agnostic [IETF-style specifications](./specs/) that any Lightning node or wallet can implement.

## Why Lightning

MPP is payment-method agnostic by design — the right payment method depends on the context. Lightning brings something unique to the table.

**No one controls it.** Bitcoin is an open network. Anyone can run a node, verify transactions, and move money without depending on a third party. A payment layer for the open internet should be just as open as the network it runs on.

**Private by default.** Lightning payments are onion-routed. When an agent pays for an API call, the only parties who know are the payer and the payee.

**Unmatched network effects.** Bitcoin has more liquidity than all stablecoins combined by an order of magnitude. Cash App, Coinbase, Binance, Strike, Kraken, and most major fintechs already support Lightning.

## How it works

1. Client requests a resource.
2. Server returns `402 Payment Required` with a fresh [BOLT11](https://github.com/lightning/bolts/blob/master/11-payment-encoding.md) invoice.
3. Client pays the invoice over the Lightning Network.
4. Client retries with the payment preimage as proof.
5. Server verifies `sha256(preimage) == paymentHash` locally and returns the resource with a receipt.

No external payment processor. No polling. No webhooks. The preimage _is_ the proof of payment.

## Getting started

### Installation

```bash
npm install spark-mppx mppx
```

### Server

Uses the Web-standard `Request`/`Response` API — works with Node.js, Cloudflare Workers, Next.js, and any other runtime.

```ts
import { Mppx, spark } from 'spark-mppx/server'

const mppx = Mppx.create({
  methods: [spark.charge({ mnemonic: process.env.MNEMONIC! })],
  secretKey: process.env.MPP_SECRET_KEY!,
})

export async function handler(request: Request): Promise<Response> {
  const result = await mppx.charge({
    amount: '100',
    currency: 'BTC',
    description: 'Premium API access',
  })(request)

  if (result.status === 402) return result.challenge

  return result.withReceipt(Response.json({ data: '...' }))
}
```

### Client

The MPP client intercepts 402 responses automatically — paying invoices and retrying with credentials before returning the final response to your code.

```ts
import { Mppx, spark } from 'spark-mppx/client'

const method = spark.charge({ mnemonic: process.env.MNEMONIC! })
const mppx = Mppx.create({ polyfill: false, methods: [method] })

try {
  const response = await mppx.fetch('https://api.example.com/weather')
  console.log(await response.json())
} finally {
  await method.cleanup()
}
```

Or patch `globalThis.fetch` so all requests are payment-aware:

```ts
import { Mppx, spark } from 'spark-mppx/client'

Mppx.create({ methods: [spark.charge({ mnemonic: process.env.MNEMONIC! })] })

const response = await fetch('https://api.example.com/weather')
```
## Configuration

### Server — `spark.charge()`

| Parameter  | Type                                     | Required | Default     |
| ---------- | ---------------------------------------- | -------- | ----------- |
| `mnemonic` | `string`                                 | Yes      |             |
| `network`  | `'mainnet'` \| `'regtest'` \| `'signet'` | No       | `'mainnet'` |

### Server — `mppx.charge()`

| Parameter     | Type     | Required | Default |
| ------------- | -------- | -------- | ------- |
| `amount`      | `string` | Yes      |         |
| `currency`    | `string` | No       | `'BTC'` |
| `description` | `string` | No       |         |

### Client — `spark.charge()`

| Parameter    | Type                                     | Required | Default     |
| ------------ | ---------------------------------------- | -------- | ----------- |
| `mnemonic`   | `string`                                 | Yes      |             |
| `network`    | `'mainnet'` \| `'regtest'` \| `'signet'` | No       | `'mainnet'` |
| `maxFeeSats` | `number`                                 | No       | `100`       |

## Examples

The `examples/` directory contains a weather API demo — a server that charges 100 sats per request and a client that pays automatically. Both run on regtest using Spark wallets.

```bash
# Terminal 1
npm run example:server

# Terminal 2
npm run example:client
```

## Wallet funding

On **mainnet**, fund your client wallet by depositing sats via Spark, Lightning, or L1:

```ts
import { SparkWallet } from '@buildonspark/spark-sdk'

const { wallet } = await SparkWallet.initialize({ mnemonicOrSeed: mnemonic })

// Spark
console.log(await wallet.getSparkAddress())
// sprt1pqqqqq2yuzewtxcnuswt8xnz6gdwmspk5ln3gl4wfar4stc7qa9xscvflqe

// L1 (Bitcoin on-chain)
console.log(await wallet.getStaticDepositAddress())
// bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh
```

For Lightning, generate a deposit invoice with `wallet.createLightningInvoice({ amountSats, memo })`.

On **regtest**, use the [Spark faucet](https://docs.spark.money/tools/faucet).

## Specifications

The Lightning payment method is defined in two IETF-formatted specifications within the [HTTP Payment Authentication](https://paymentauth.org) framework:

- [`draft-lightning-charge-00`](./specs/draft-lightning-charge-00.txt) — One-time BOLT11 invoice payments
- [`draft-lightning-session-00`](./specs/draft-lightning-session-00.txt) — Prepaid sessions with per-unit billing and refund on close

## License

MIT
