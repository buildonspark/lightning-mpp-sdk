/**
 * Example: metered text-generation API using the Lightning session payment method.
 *
 * Each GET /generate request opens an SSE stream with a RANDOM number of chunks
 * (100–300), simulating an LLM endpoint where token count is unknown upfront.
 * The server charges 2 sats per chunk via sessionMethod.serve(), which handles
 * per-chunk billing, payment-need-topup events, and hold-open-and-resume
 * automatically — preserving the upstream connection on balance exhaustion.
 *
 * Run with: npm run example:server-session
 */
import { Credential } from 'mppx'
import { Mppx, Store, spark } from '../src/server/index.js'
import { createServer } from 'node:http'

const SERVER_MNEMONIC = 'fence neck outer stuff system visa eagle gather conduct exact zero awkward'

const SATS_PER_CHUNK = 2
const DEPOSIT_SATS = 300 // covers 150 chunks; longer streams trigger a mid-stream top-up

const sessionMethod = spark.session({
  mnemonic: SERVER_MNEMONIC,
  network: 'regtest',
  depositAmount: DEPOSIT_SATS,
  store: Store.memory(),
})

const mppx = Mppx.create({
  methods: [sessionMethod],
  secretKey: process.env.MPP_SECRET_KEY ?? 'dev-secret-key-change-in-production',
  realm: 'text-gen-api',
})

let streamCount = 0

export async function handler(request: Request): Promise<Response> {
  const result = await mppx.session({ amount: String(SATS_PER_CHUNK), currency: 'sat', description: 'LLM stream' })(
    request,
  )

  if (result.status === 402) {
    console.log('→ 402 Payment Required')
    return result.challenge
  }

  // Management actions (topUp, close) are fully handled by the respond() hook.
  const cred = Credential.fromRequest<{ action: string }>(request)
  if (cred.payload.action === 'topUp' || cred.payload.action === 'close') {
    return result.withReceipt()
  }

  // Random chunk count — unknown upfront, like a real LLM response.
  const chunkCount = Math.floor(Math.random() * 201) + 100 // 100–300

  streamCount++
  const streamId = streamCount
  console.log(`✓ Stream #${streamId} authenticated — ${chunkCount} chunks (~${chunkCount * SATS_PER_CHUNK} sats)`)

  async function* generate() {
    for (let i = 0; i < chunkCount; i++) {
      yield JSON.stringify({ chunk: WORDS[i % WORDS.length]! + ' ', index: i })
      await new Promise((r) => setTimeout(r, 20))
    }
    console.log(`  stream #${streamId} complete — ${chunkCount} chunks, ${chunkCount * SATS_PER_CHUNK} sats`)
  }

  return result.withReceipt(
    sessionMethod.serve({ request, generate: generate() }),
  )
}

const WORDS = [
  'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'and', 'then',
  'sat', 'down', 'by', 'river', 'bank', 'watching', 'sunset', 'glow', 'across',
  'vast', 'open', 'fields', 'of', 'golden', 'wheat', 'swaying', 'gently', 'in',
  'warm', 'evening', 'breeze', 'while', 'birds', 'sang', 'their', 'last', 'songs',
  'before', 'night', 'fell', 'upon', 'sleepy', 'valley', 'below', 'silent', 'hills',
  'far', 'away', 'distant', 'mountains',
]

const port = Number(process.env.PORT ?? 3001)

const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }
  if (req.method !== 'GET' || req.url !== '/generate') {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const url = `http://localhost:${port}${req.url}`
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k] = v
  }

  const webRequest = new Request(url, { method: req.method, headers })
  const webResponse = await handler(webRequest)
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()))

  if (webResponse.body) {
    const reader = webResponse.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
    res.end()
  } else {
    res.end(await webResponse.text())
  }
})

server.listen(port, () => {
  console.log(`Text generation API server running on http://localhost:${port}`)
  console.log(`  GET /generate — random 100–300 chunks @ ${SATS_PER_CHUNK} sats each`)
  console.log(`  deposit: ${DEPOSIT_SATS} sats — balance exhaustion pauses stream until top-up`)
})
