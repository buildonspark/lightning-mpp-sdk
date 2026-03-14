import type { Express } from 'express'
import type { AppContext } from '../index.js'
import { SparkWallet } from '@buildonspark/spark-sdk'

const PAYOUT_SATS = 5000

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
  // GET /api/v1/faucet/status — returns availability and balance
  app.get('/api/v1/faucet/status', async (_req, res) => {
    try {
      const wallet = await getServerWallet(ctx.serverMnemonic)
      const { balance } = await wallet.getBalance()
      const balanceSats = Number(balance)
      res.json({
        available: balanceSats >= PAYOUT_SATS,
        payout_sats: PAYOUT_SATS,
        balance_sats: balanceSats,
      })
    } catch {
      res.json({ available: false, payout_sats: PAYOUT_SATS, balance_sats: 0 })
    }
  })

  // POST /api/v1/faucet/claim — body: { sparkAddress }
  app.post('/api/v1/faucet/claim', async (req, res) => {
    const { sparkAddress } = req.body ?? {}
    if (!sparkAddress || typeof sparkAddress !== 'string') {
      res.status(400).json({ error: 'Missing sparkAddress in request body' })
      return
    }

    try {
      const wallet = await getServerWallet(ctx.serverMnemonic)
      const { balance } = await wallet.getBalance()
      if (Number(balance) < PAYOUT_SATS) {
        res.status(503).json({ error: 'Faucet is empty' })
        return
      }
      await wallet.transfer({ receiverSparkAddress: sparkAddress, amountSats: PAYOUT_SATS })
      res.json({ success: true, payout_sats: PAYOUT_SATS })
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })
}
