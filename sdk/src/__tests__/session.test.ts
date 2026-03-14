/**
 * Tests for the session server's state machine.
 *
 * deduct(), waitForTopUp(), and the store transitions are the most complex
 * logic in the SDK. These tests exercise them directly without needing a
 * real Spark wallet (wallet init only happens on request() / closeSession(),
 * neither of which is called here).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from 'mppx/server'
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'
import { session } from '../server/Session.js'

const FAKE_MNEMONIC = 'test test test test test test test test test test test junk'

type SessionState = {
  paymentHash: string
  depositSats: number
  spent: number
  returnInvoice: string
  status: 'open' | 'closed'
}

function storeKey(id: string) {
  return `lightning-session:${id}`
}

function openState(id: string, depositSats = 100): SessionState {
  return { paymentHash: id, depositSats, spent: 0, returnInvoice: 'lnbcrt1...', status: 'open' }
}

test('deduct: succeeds and persists updated balance', async () => {
  const store = Store.memory()
  const s = session({ mnemonic: FAKE_MNEMONIC, store, idleTimeout: 0 })
  const id = bytesToHex(randomBytes(16))
  await store.put(storeKey(id), openState(id))

  assert.equal(await s.deduct(id, 10), true)

  const state = await store.get<SessionState>(storeKey(id))
  assert.equal(state?.spent, 10)
})

test('deduct: returns false when balance is insufficient', async () => {
  const store = Store.memory()
  const s = session({ mnemonic: FAKE_MNEMONIC, store, idleTimeout: 0 })
  const id = bytesToHex(randomBytes(16))
  await store.put(storeKey(id), openState(id, 5))

  assert.equal(await s.deduct(id, 10), false)

  // No state change
  const state = await store.get<SessionState>(storeKey(id))
  assert.equal(state?.spent, 0)
})

test('deduct: multiple successful deductions accumulate', async () => {
  const store = Store.memory()
  const s = session({ mnemonic: FAKE_MNEMONIC, store, idleTimeout: 0 })
  const id = bytesToHex(randomBytes(16))
  await store.put(storeKey(id), openState(id, 50))

  assert.equal(await s.deduct(id, 10), true)
  assert.equal(await s.deduct(id, 10), true)
  assert.equal(await s.deduct(id, 10), true)

  const state = await store.get<SessionState>(storeKey(id))
  assert.equal(state?.spent, 30)
})

test('deduct: returns false when balance is exactly exhausted', async () => {
  const store = Store.memory()
  const s = session({ mnemonic: FAKE_MNEMONIC, store, idleTimeout: 0 })
  const id = bytesToHex(randomBytes(16))
  await store.put(storeKey(id), openState(id, 10))

  assert.equal(await s.deduct(id, 10), true)
  assert.equal(await s.deduct(id, 1), false)
})

test('deduct: throws when session is closed', async () => {
  const store = Store.memory()
  const s = session({ mnemonic: FAKE_MNEMONIC, store, idleTimeout: 0 })
  const id = bytesToHex(randomBytes(16))
  await store.put(storeKey(id), { ...openState(id), status: 'closed' })

  await assert.rejects(() => s.deduct(id, 10), /already closed/)
})

test('deduct: throws when session does not exist', async () => {
  const store = Store.memory()
  const s = session({ mnemonic: FAKE_MNEMONIC, store, idleTimeout: 0 })

  await assert.rejects(() => s.deduct('nonexistent-id', 10), /not found/)
})

test('waitForTopUp: returns false after timeout', async () => {
  const store = Store.memory()
  const s = session({ mnemonic: FAKE_MNEMONIC, store, idleTimeout: 0 })
  const id = bytesToHex(randomBytes(16))

  const result = await s.waitForTopUp(id, 10) // 10 ms
  assert.equal(result, false)
})
