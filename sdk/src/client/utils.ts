import { NETWORK_MAP } from '../constants.js'

export { NETWORK_MAP }

/**
 * Minimal wallet interface used internally by charge/session methods.
 *
 * Using a structural interface instead of `InstanceType<typeof SparkWallet>`
 * directly avoids TypeScript incompatibility errors when a pre-initialized
 * wallet from a different module resolution copy of @buildonspark/spark-sdk
 * is passed in (e.g. from a consuming app's own node_modules).
 */
export interface WalletLike {
  payLightningInvoice(params: { invoice: string; maxFeeSats: number }): Promise<{ paymentPreimage?: string; id?: string }>
  getLightningSendRequest(id: string): Promise<{ paymentPreimage?: string; status?: string } | null>
  createLightningInvoice(params: { amountSats: number; memo: string; expirySeconds: number }): Promise<{ invoice: { encodedInvoice: string } }>
  cleanupConnections(): Promise<void>
}

/**
 * Polls the wallet for the payment preimage after `payLightningInvoice`.
 * Spark sometimes returns the preimage asynchronously, so this retries until
 * the payment settles or the attempt limit is reached.
 */
export async function resolvePreimage(
  wallet: WalletLike,
  result: Awaited<ReturnType<WalletLike['payLightningInvoice']>>,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<string> {
  if ('paymentPreimage' in result && result.paymentPreimage) {
    return result.paymentPreimage
  }

  if (!result.id) {
    throw new Error('Unexpected payLightningInvoice result format')
  }

  const FAILURE_STATUSES = new Set(['LIGHTNING_PAYMENT_FAILED', 'TRANSFER_FAILED', 'FAILED'])
  for (let i = 0; i < maxAttempts; i++) {
    const req = await wallet.getLightningSendRequest(result.id)
    if (req?.paymentPreimage) return req.paymentPreimage
    if (req?.status && FAILURE_STATUSES.has(req.status)) {
      throw new Error(`Lightning payment failed: ${req.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error('Timed out waiting for payment preimage')
}
