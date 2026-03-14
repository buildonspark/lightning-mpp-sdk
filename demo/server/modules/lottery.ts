import type { Express } from 'express'
import type { AppContext } from '../index.js'
import { SparkWallet } from '@buildonspark/spark-sdk'
import { Mppx, spark } from '../sdk.js'
import { toWebRequest } from '../utils.js'

interface Winner {
  sparkAddress: string
  amountSats: number
  timestamp: string
}

let potSats = 0
let totalTickets = 0
const recentWinners: Winner[] = []

let serverWalletPromise: Promise<InstanceType<typeof SparkWallet>> | null = null

function getServerWallet(mnemonic: string) {
  if (!serverWalletPromise) {
    serverWalletPromise = SparkWallet.initialize({
      mnemonicOrSeed: mnemonic,
      options: { network: 'REGTEST' },
    }).then(({ wallet }) => wallet)
      .catch((e) => { serverWalletPromise = null; throw e })
  }
  return serverWalletPromise
}

export function register(app: Express, ctx: AppContext) {
  const mppx = Mppx.create({
    methods: [spark.charge({ mnemonic: ctx.serverMnemonic, network: 'regtest' })],
    secretKey: ctx.secretKey,
    realm: 'lottery',
  })

  // GET /api/v1/lottery/status — free
  app.get('/api/v1/lottery/status', (_req, res) => {
    res.json({ potSats, totalTickets, recentWinners: recentWinners.slice(-5).reverse() })
  })

  // POST /api/v1/lottery/buy — 10 sats, body: { sparkAddress }
  app.post('/api/v1/lottery/buy', async (req, res) => {
    const { sparkAddress } = req.body ?? {}
    if (!sparkAddress || typeof sparkAddress !== 'string') {
      res.status(400).json({ error: 'Missing sparkAddress in request body' })
      return
    }

    const webReq = toWebRequest(req)
    const result = await mppx.charge({ amount: '10', currency: 'sat', description: 'Lottery ticket' })(webReq)

    if (result.status === 402) {
      const challenge = result.challenge
      res.status(challenge.status)
      challenge.headers.forEach((v, k) => res.setHeader(k, v))
      res.send(await challenge.text())
      return
    }

    // Payment verified — roll the ticket
    potSats += 10
    totalTickets += 1
    const won = Math.random() < 0.25 // 25% chance

    let message: string
    let paidOut = 0

    if (won && potSats > 0) {
      paidOut = potSats
      potSats = 0  // claim the pot before awaiting to prevent double-payout on concurrent winners
      try {
        const wallet = await getServerWallet(ctx.serverMnemonic)
        await wallet.transfer({ receiverSparkAddress: sparkAddress, amountSats: paidOut })
        recentWinners.push({ sparkAddress, amountSats: paidOut, timestamp: new Date().toISOString() })
        if (recentWinners.length > 20) recentWinners.shift()
        message = `You won! ${paidOut} sats sent to your Spark address.`
      } catch (err: unknown) {
        potSats += paidOut  // restore on transfer failure so the pot isn't lost
        message = `You won but payout failed: ${err instanceof Error ? err.message : String(err)}`
        paidOut = 0
      }
    } else {
      message = `No luck this time. Pot is now ${potSats} sats.`
    }

    const responseBody = { won, potSats, paidOutSats: paidOut, totalTickets, message }
    const resp = result.withReceipt(Response.json(responseBody))
    res.status(resp.status)
    resp.headers.forEach((v, k) => res.setHeader(k, v))
    res.send(await resp.text())
  })
}
