/**
 * Example: MPP weather API server using the Spark Lightning payment method.
 *
 * Run with: npm run example:server
 */
import { Mppx, spark } from '../src/server/index.js'

const SERVER_MNEMONIC = 'fence neck outer stuff system visa eagle gather conduct exact zero awkward'

const mppx = Mppx.create({
  methods: [spark.charge({ mnemonic: SERVER_MNEMONIC, network: 'regtest' })],
  secretKey: process.env.MPP_SECRET_KEY ?? 'dev-secret-key-change-in-production',
  realm: 'weather-api',
})

export async function handler(request: Request): Promise<Response> {
  const result = await mppx.charge({
    amount: '100',
    currency: 'sat',
    description: 'Weather report',
  })(request)

  if (result.status === 402) {
    console.log('→ 402 Payment Required — invoice issued')
    return result.challenge
  }

  console.log('✓ Payment verified — serving resource')

  return result.withReceipt(
    Response.json({
      location: 'Los Angeles, CA',
      temperature: 78,
      unit: 'F',
      conditions: 'Sunny',
      humidity: 45,
      wind: { speed: 8, direction: 'SW', unit: 'mph' },
      forecast: 'Warm and sunny with clear skies throughout the day.',
    }),
  )
}

// Minimal Node.js HTTP server wrapping the web-standard handler
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 3000)

const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  if (req.method !== 'GET' || req.url !== '/weather') {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const url = `http://localhost:${port}${req.url}`
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key] = value
  }

  const webRequest = new Request(url, { method: req.method, headers })
  const webResponse = await handler(webRequest)

  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()))
  res.end(await webResponse.text())
})

server.listen(port, () => {
  console.log(`Weather API server running on http://localhost:${port}`)
  console.log(`  GET /weather — requires Lightning payment (100 sats)`)
  console.log(`  GET /health  — free health check`)
})
