import type { Express } from 'express'
import type { AppContext } from '../index.js'
import { Mppx, spark } from '../sdk.js'
import { toWebRequest } from '../utils.js'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

export function register(app: Express, ctx: AppContext) {
  const mppx = Mppx.create({
    methods: [spark.charge({ mnemonic: ctx.serverMnemonic, network: 'regtest' })],
    secretKey: ctx.secretKey,
    realm: 'stocks',
  })

  async function chargeAndRespond(
    req: import('express').Request,
    res: import('express').Response,
    amountSats: number,
    description: string,
    getData: () => Promise<unknown>,
  ) {
    const webReq = toWebRequest(req)
    const result = await mppx.charge({
      amount: String(amountSats),
      currency: 'sat',
      description,
    })(webReq)

    if (result.status === 402) {
      const challenge = result.challenge
      res.status(challenge.status)
      challenge.headers.forEach((v, k) => res.setHeader(k, v))
      res.send(await challenge.text())
      return
    }

    try {
      const data = await getData()
      const resp = result.withReceipt(Response.json(data))
      res.status(resp.status)
      resp.headers.forEach((v, k) => res.setHeader(k, v))
      res.send(await resp.text())
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch stock data' })
    }
  }

  // GET /quote/:symbol — 10 sats
  app.get('/api/v1/stocks/quote/:symbol', async (req, res) => {
    await chargeAndRespond(req, res, 10, `Quote for ${req.params.symbol}`, () =>
      yahooFinance.quote(req.params.symbol),
    )
  })

  // GET /search?q= — 10 sats
  app.get('/api/v1/stocks/search', async (req, res) => {
    const q = String(req.query.q ?? '')
    if (!q) {
      res.status(400).json({ error: 'Missing query parameter q' })
      return
    }
    await chargeAndRespond(req, res, 10, `Search: ${q}`, () =>
      yahooFinance.search(q),
    )
  })

  // GET /history/:symbol?range= — 50 sats
  // range values: 1d, 5d, 1mo, 3mo, 6mo, 1y
  app.get('/api/v1/stocks/history/:symbol', async (req, res) => {
    const range = String(req.query.range ?? '1mo')
    const now = new Date()
    const period1 = new Date(now)
    switch (range) {
      case '1d':  period1.setDate(now.getDate() - 1); break
      case '5d':  period1.setDate(now.getDate() - 5); break
      case '3mo': period1.setMonth(now.getMonth() - 3); break
      case '6mo': period1.setMonth(now.getMonth() - 6); break
      case '1y':  period1.setFullYear(now.getFullYear() - 1); break
      default:    period1.setMonth(now.getMonth() - 1); break // 1mo
    }
    await chargeAndRespond(req, res, 50, `History for ${req.params.symbol} (${range})`, () =>
      yahooFinance.chart(req.params.symbol, { period1 }),
    )
  })
}
