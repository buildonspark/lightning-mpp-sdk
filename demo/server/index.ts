import express from 'express'
import cors from 'cors'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SparkWallet } from '@buildonspark/spark-sdk'
import * as stocks from './modules/stocks.js'
import * as lottery from './modules/lottery.js'
import * as faucet from './modules/faucet.js'
import * as chatbot from './modules/chatbot.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

if (!process.env.SERVER_MNEMONIC) {
  console.error('Error: SERVER_MNEMONIC environment variable is required')
  process.exit(1)
}
if (!process.env.MPP_SECRET_KEY) {
  console.error('Error: MPP_SECRET_KEY environment variable is required')
  process.exit(1)
}

export interface AppContext {
  serverMnemonic: string
  secretKey: string
}

const ctx: AppContext = {
  serverMnemonic: process.env.SERVER_MNEMONIC,
  secretKey: process.env.MPP_SECRET_KEY,
}

const app = express()
app.use(cors({ exposedHeaders: ['WWW-Authenticate', 'Authorization', 'Payment-Receipt'] }))
app.use(express.json())

let serverWalletPromise: Promise<InstanceType<typeof SparkWallet>> | null = null
function getServerWallet() {
  if (!serverWalletPromise) {
    serverWalletPromise = SparkWallet.initialize({
      mnemonicOrSeed: ctx.serverMnemonic,
      options: { network: 'REGTEST' },
    }).then(({ wallet }) => wallet)
      .catch((e) => { serverWalletPromise = null; throw e })
  }
  return serverWalletPromise
}

// Health check
app.get('/health', async (_req, res) => {
  try {
    const wallet = await getServerWallet()
    const address = await wallet.getSparkAddress()
    res.json({ status: 'ok', address })
  } catch {
    res.json({ status: 'ok', address: null })
  }
})

// Register modules
stocks.register(app, ctx)
lottery.register(app, ctx)
faucet.register(app, ctx)
if (process.env.OPENAI_API_KEY) {
  chatbot.register(app, ctx)
} else {
  console.warn('OPENAI_API_KEY not set — chatbot module disabled')
}

// Serve built SPA in production
const spaDir = join(__dirname, '../app/dist')
app.use(express.static(spaDir))
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(spaDir, 'index.html')))

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  console.log(`Demo server running on http://localhost:${port}`)
  console.log(`  GET  /api/v1/stocks/quote/:symbol  (10 sats)`)
  console.log(`  GET  /api/v1/stocks/search?q=       (10 sats)`)
  console.log(`  GET  /api/v1/stocks/history/:symbol  (50 sats)`)
  console.log(`  GET  /api/v1/lottery/status          (free)`)
  console.log(`  POST /api/v1/lottery/buy             (10 sats)`)
  console.log(`  GET  /api/v1/faucet/status           (free)`)
  console.log(`  POST /api/v1/faucet/claim            (free)`)
  console.log(`  POST /api/v1/chatbot/chat            (2 sats/chunk, session)`)
})
