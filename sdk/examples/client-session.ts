/**
 * Example: metered LLM client using the Lightning session payment method.
 *
 * Each stream has a random length (100–300 chunks, unknown upfront). If the
 * session balance runs out mid-stream, the server emits a `payment-need-topup` SSE
 * event and holds the connection open. The client pays a new deposit invoice,
 * sends a topUp credential, and the server resumes the same stream — no reconnect,
 * no lost upstream state.
 *
 * Run with: npm run example:client-session
 */
import { Mppx, spark } from '../src/client/index.js'

const CLIENT_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const method = spark.session({ mnemonic: CLIENT_MNEMONIC, network: 'regtest' })
const mppx = Mppx.create({ polyfill: false, methods: [method] })
const BASE_URL = `http://localhost:${process.env.PORT ?? 3001}`

/**
 * Reads an SSE stream to completion. When the server emits a `payment-need-topup`
 * event, calls `onTopUp` (which pays the invoice and calls method.topUp) then
 * continues reading from the same connection — the server resumes the stream
 * without closing it.
 */
async function consumeStream(
  response: Response,
  onTopUp: (data: { sessionId: string; balanceRequired: number; balanceSpent: number }) => Promise<void>,
): Promise<number> {
  if (!response.body) return 0
  const reader = response.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let chunks = 0
  let eventType = 'message'

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (eventType === 'payment-need-topup') {
          process.stdout.write('\n')
          await onTopUp(JSON.parse(data))
          eventType = 'message'
        } else if (eventType === 'session-timeout') {
          process.stdout.write('\n')
          const { balanceSpent, balanceRequired } = JSON.parse(data)
          console.warn(`  ⚠ session-timeout: spent=${balanceSpent} need=${balanceRequired} — stream closed by server`)
          eventType = 'message'
          return chunks
        } else if (eventType === 'payment-receipt') {
          eventType = 'message'
        } else if (data === '[DONE]') {
          return chunks
        } else {
          const { chunk } = JSON.parse(data)
          process.stdout.write(chunk)
          chunks++
          eventType = 'message'
        }
      }
    }
  }

  return chunks
}

/**
 * Makes a streaming request and reads it to completion, automatically topping
 * up mid-stream if the server signals payment-need-topup. Because the server
 * holds the connection open, the stream resumes seamlessly on the same response.
 */
async function generate(label: string): Promise<number> {
  console.log(`\n→ ${label}: GET ${BASE_URL}/generate`)

  const response = await mppx.fetch(`${BASE_URL}/generate`)
  if (!response.ok) {
    console.error(`✗ ${response.status} ${response.statusText}: ${await response.text()}`)
    process.exit(1)
  }

  const sess = method.getSession()
  if (sess) console.log(`  session: ${sess.sessionId.slice(0, 16)}…`)

  let topUpCount = 0
  process.stdout.write('  stream:  ')

  const chunks = await consumeStream(response, async ({ sessionId, balanceRequired, balanceSpent }) => {
    topUpCount++
    console.log(`  ⚡ payment-need-topup: session=${sessionId.slice(0, 16)}… spent=${balanceSpent} need=${balanceRequired}`)
    console.log(`  topping up…`)
    const topUpResponse = await method.topUp(mppx.fetch, `${BASE_URL}/generate`)
    if (!topUpResponse.ok) {
      console.error(`✗ top-up failed: ${topUpResponse.status}: ${await topUpResponse.text()}`)
      process.exit(1)
    }
    console.log(`  ✓ top-up complete — stream resuming`)
    process.stdout.write('  resumed: ')
  })

  process.stdout.write('\n')
  console.log(`  chunks: ${chunks} total${topUpCount > 0 ? ` (${topUpCount} top-up${topUpCount > 1 ? 's' : ''})` : ''}`)
  return chunks
}

try {
  const chunks1 = await generate('Stream 1 (opens session, pays deposit)')
  const chunks2 = await generate('Stream 2 (bearer auth)')
  const chunks3 = await generate('Stream 3 (bearer auth)')

  const totalSats = (chunks1 + chunks2 + chunks3) * 2
  console.log(`\n  total: ${chunks1 + chunks2 + chunks3} chunks, ${totalSats} sats charged`)

  console.log(`\n→ Closing session (refunding unspent balance)…`)
  const closeResponse = await method.close(mppx.fetch, `${BASE_URL}/generate`)
  if (closeResponse.ok) {
    const body = await closeResponse.json()
    console.log(`✓ Session closed. Refunded: ${body.refundSats} sats`)
  } else {
    console.error(`✗ Close failed: ${closeResponse.status}: ${await closeResponse.text()}`)
  }
} finally {
  await method.cleanup()
}
