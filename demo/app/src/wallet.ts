import { SparkWallet } from '@buildonspark/spark-sdk'
import * as bip39 from 'bip39'
import { Mppx, spark } from 'spark-mppx/client'
import type { charge as chargeNS, session as sessionNS } from 'spark-mppx/client'

// ─── Wallet management ────────────────────────────────────────────────────────

const STORAGE_KEY = 'spark_mpp_wallet'

export function generateWallet(): string {
  const mnemonic = bip39.generateMnemonic()
  localStorage.setItem(STORAGE_KEY, mnemonic)
  resetSdkClients()
  walletPromise = null
  return mnemonic
}

export function loadMnemonic(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function importWallet(mnemonic: string): void {
  if (!bip39.validateMnemonic(mnemonic)) throw new Error('Invalid mnemonic phrase')
  localStorage.setItem(STORAGE_KEY, mnemonic)
  resetSdkClients()
  walletPromise = null
}

export function clearWallet(): void {
  localStorage.removeItem(STORAGE_KEY)
  resetSdkClients()
  walletPromise = null
}

// ─── Spark wallet singleton (for balance / address queries) ───────────────────

let walletPromise: Promise<InstanceType<typeof SparkWallet>> | null = null

export async function getWallet(): Promise<InstanceType<typeof SparkWallet>> {
  if (!walletPromise) {
    const mnemonic = loadMnemonic()
    if (!mnemonic) throw new Error('No wallet configured')
    walletPromise = SparkWallet.initialize({
      mnemonicOrSeed: mnemonic,
      options: { network: 'REGTEST' },
    }).then(({ wallet }) => wallet)
      .catch((e) => { walletPromise = null; throw e })
  }
  return walletPromise
}

// ─── SDK client singletons ────────────────────────────────────────────────────
//
// Both spark.charge (for payAndFetch) and spark.session (for streamChat) are
// held as module-level singletons so the underlying Spark wallet is initialised
// once and reused across calls. Each method is passed the wallet instance from
// getWallet() rather than a mnemonic, ensuring a single wallet connection.
//
// Per-call onProgress callbacks are routed through dispatch variables so the
// constructor-time onProgress can stay stable while still delivering events to
// whatever caller is currently active.

let _chargeMethod: ReturnType<typeof spark.charge> | null = null
let _mppxCharge: ReturnType<typeof Mppx.create> | null = null
let _chargeDispatch: ((e: chargeNS.ProgressEvent) => void) | null = null

let _sessionMethod: ReturnType<typeof spark.session> | null = null
let _mppxSession: ReturnType<typeof Mppx.create> | null = null
let _sessionDispatch: ((e: sessionNS.ProgressEvent) => void) | null = null

function resetSdkClients() {
  _chargeMethod?.cleanup().catch(() => {})
  _sessionMethod?.cleanup().catch(() => {})
  _chargeMethod = null
  _mppxCharge = null
  _sessionMethod = null
  _mppxSession = null
}

async function getChargeClient() {
  if (!_chargeMethod) {
    const wallet = await getWallet()
    _chargeMethod = spark.charge({
      wallet,
      network: 'regtest',
      onProgress: (e) => _chargeDispatch?.(e),
    })
    _mppxCharge = Mppx.create({ methods: [_chargeMethod] })
  }
  return { method: _chargeMethod, mppx: _mppxCharge! }
}

async function getSessionClient() {
  if (!_sessionMethod) {
    const wallet = await getWallet()
    _sessionMethod = spark.session({
      wallet,
      network: 'regtest',
      onProgress: (e) => _sessionDispatch?.(e),
    })
    _mppxSession = Mppx.create({ methods: [_sessionMethod] })
  }
  return { method: _sessionMethod, mppx: _mppxSession! }
}

// ─── Async step queue ─────────────────────────────────────────────────────────
//
// Bridges the callback-based onProgress API with async generator consumers.
// The generator suspends waiting for the next item; push() wakes it up.

class StepQueue<T> {
  private items: T[] = []
  private notify: (() => void) | null = null
  private done = false

  push(item: T) {
    this.items.push(item)
    this.notify?.()
    this.notify = null
  }

  close() {
    this.done = true
    this.notify?.()
    this.notify = null
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      while (this.items.length > 0) yield this.items.shift()!
      if (this.done) return
      await new Promise<void>((r) => { this.notify = r })
    }
  }
}

// ─── payAndFetch ──────────────────────────────────────────────────────────────

export type PayStep =
  | { type: 'request'; method: string; url: string }
  | { type: 'challenge'; invoice: string; amountSats: number }
  | { type: 'paying' }
  | { type: 'paid'; preimage: string }
  | { type: 'retry' }
  | { type: 'success'; status: number; body: unknown; durationMs: number }
  | { type: 'error'; message: string }

/** Execute an API request, yielding each step. Handles 402 payment automatically. */
export async function* payAndFetch(
  path: string,
  method = 'GET',
  body?: Record<string, unknown>,
): AsyncGenerator<PayStep> {
  const t0 = Date.now()
  const displayUrl = path.replace(/^\/api\/v1/, '')

  yield { type: 'request', method, url: displayUrl }

  const queue = new StepQueue<PayStep>()

  let client: Awaited<ReturnType<typeof getChargeClient>>
  try {
    client = await getChargeClient()
  } catch (e: unknown) {
    yield { type: 'error', message: e instanceof Error ? e.message : String(e) }
    return
  }

  _chargeDispatch = (e) => {
    if (e.type === 'challenge') {
      queue.push({ type: 'challenge', invoice: e.invoice, amountSats: e.amountSats })
    } else if (e.type === 'paying') {
      queue.push({ type: 'paying' })
    } else if (e.type === 'paid') {
      queue.push({ type: 'paid', preimage: e.preimage })
    }
  }

  const fetchInit: RequestInit = {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }

  client.mppx.fetch(path, fetchInit)
    .then(async (response) => {
      const responseBody = await response.json().catch(() => response.text())
      queue.push({ type: 'success', status: response.status, body: responseBody, durationMs: Date.now() - t0 })
    })
    .catch((e: Error) => {
      queue.push({ type: 'error', message: e.message })
    })
    .finally(() => {
      _chargeDispatch = null
      queue.close()
    })

  for await (const step of queue) {
    yield step
  }
}

// ─── Chat session ─────────────────────────────────────────────────────────────

export function getChatSession() {
  return _sessionMethod?.getSession() ?? null
}

export type ChatStep =
  | { type: 'opening';    depositSats: number; satsPerChunk: number }
  | { type: 'ready';      satsPerChunk: number }
  | { type: 'chunk';      text: string }
  | { type: 'topup-start' }
  | { type: 'topup-done'; topUpSats: number }
  | { type: 'done';       spent: number; units: number }
  | { type: 'error';      message: string }

const CHAT_PATH = '/api/v1/chatbot/chat'

/**
 * Streams a chat completion, handling Lightning session payments automatically.
 * Opens a session on first call (pays a deposit), then uses bearer auth for
 * subsequent messages. Handles mid-stream top-ups transparently.
 */
export async function* streamChat(
  messages: { role: string; content: string }[],
  model: string,
): AsyncGenerator<ChatStep> {
  let client: Awaited<ReturnType<typeof getSessionClient>>
  try {
    client = await getSessionClient()
  } catch (e: unknown) {
    yield { type: 'error', message: e instanceof Error ? e.message : String(e) }
    return
  }
  const { method: sessionMethod, mppx: mppxSess } = client

  const body = { messages, model }

  // Phase 1: open/resume session via mppx.fetch, yielding onProgress events
  // in real-time using the async queue while the fetch runs in the background.
  const phase1Queue = new StepQueue<ChatStep>()
  _sessionDispatch = (e) => {
    if (e.type === 'opening') {
      phase1Queue.push({ type: 'opening', depositSats: e.depositSats, satsPerChunk: e.amount })
    } else if (e.type === 'bearer') {
      phase1Queue.push({ type: 'ready', satsPerChunk: e.amount })
    }
  }

  let response: Response | undefined
  let fetchError: Error | undefined

  const fetchPromise = mppxSess.fetch(CHAT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => { response = r })
    .catch((e: Error) => { fetchError = e })
    .finally(() => {
      _sessionDispatch = null
      phase1Queue.close()
    })

  for await (const step of phase1Queue) {
    yield step
  }
  await fetchPromise

  if (fetchError || !response || !response.ok || !response.body) {
    yield { type: 'error', message: fetchError?.message ?? `Server error: ${response?.status}` }
    return
  }

  // Phase 2: read SSE stream, handling mid-stream top-ups
  const reader = response.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let eventType = 'message'
  let receiptSpent = 0
  let receiptUnits = 0

  try {
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
            yield { type: 'topup-start' }
            let topUpSats = 0
            _sessionDispatch = (e) => {
              if (e.type === 'topped-up') topUpSats = e.topUpSats
            }
            try {
              await sessionMethod.topUp((url, init) => mppxSess.fetch(url as string, init), CHAT_PATH)
            } finally {
              _sessionDispatch = null
            }
            yield { type: 'topup-done', topUpSats }
            eventType = 'message'
          } else if (eventType === 'session-timeout') {
            // Server closed the held connection after waiting too long for top-up.
            yield { type: 'error', message: 'Session timed out waiting for top-up' }
            eventType = 'message'
            return
          } else if (eventType === 'payment-receipt') {
            try {
              const receipt = JSON.parse(data)
              receiptSpent = receipt.spent ?? 0
              receiptUnits = receipt.units ?? 0
            } catch (e) { console.warn('[mpp] Failed to parse payment-receipt:', data, e) }
            eventType = 'message'
          } else if (data === '[DONE]') {
            yield { type: 'done', spent: receiptSpent, units: receiptUnits }
            return
          } else {
            try {
              const { text } = JSON.parse(data)
              if (text) yield { type: 'chunk', text }
            } catch (e) { console.warn('[mpp] Malformed SSE data:', data, e) }
            eventType = 'message'
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}
