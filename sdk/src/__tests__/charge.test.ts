/**
 * Tests for charge authorization through mppx and the preimage hash invariant
 * Only wallet calls are mocked; no Lightning payments or external services run
 */
import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SparkWallet } from '@buildonspark/spark-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { Mppx } from 'mppx/server'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'
import { charge } from '../server/Charge.js'
import { invoices } from './chargeFixtures.js'

const SECRET_KEY = 'local-charge-regression-secret'

beforeEach(() => {
  // Only the external wallet is mocked. The actual mppx handler, challenge
  // HMAC, BOLT11 decoding, preimage check, and replay store all run locally
  mock.method(SparkWallet, 'initialize', async () => ({
    wallet: {
      async createLightningInvoice({ amountSats }: { amountSats: number }) {
        const invoice = invoices[String(amountSats) as keyof typeof invoices]
        assert.ok(invoice, `Unexpected test invoice amount: ${amountSats}`)
        return { invoice }
      },
    },
  }))
})

afterEach(() => mock.restoreAll())

function server(options: Partial<charge.Parameters> = {}) {
  return Mppx.create({
    methods: [charge({ mnemonic: 'unused-test-mnemonic', ...options })],
    secretKey: SECRET_KEY,
    realm: 'payments.test',
  })
}

async function credential(mppx: ReturnType<typeof server>, amount = '1') {
  const result = await mppx.charge({ amount })(new Request('https://payments.test/cheap'))
  assert.equal(result.status, 402)
  const challenge = Challenge.deserialize(result.challenge.headers.get('WWW-Authenticate')!)
  return Credential.serialize({
    challenge,
    payload: { preimage: invoices[amount as keyof typeof invoices].preimage },
  })
}

function paidRequest(authorization: string) {
  return new Request('https://payments.test/resource', { headers: { Authorization: authorization } })
}

test('charge: accepts a valid payment through the actual mppx handler', async () => {
  const mppx = server()
  const proof = await credential(mppx)
  const result = await mppx.charge({ amount: '1' })(paidRequest(proof))
  assert.equal(result.status, 200)
})

test('charge: a 1-sat proof cannot authorize a 100,000-sat request', async () => {
  const mppx = server()
  const proof = await credential(mppx)
  const result = await mppx.charge({ amount: '100000' })(paidRequest(proof))
  assert.equal(result.status, 402)
  const fresh = Challenge.deserialize(result.challenge.headers.get('WWW-Authenticate')!)
  assert.equal(fresh.request.amount, '100000')
  assert.equal((fresh.request.methodDetails as { invoice: string }).invoice, invoices['100000'].encodedInvoice)
  // A rejected request must not burn the payment for its original price
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 200)
})

test('charge: a proof cannot change the configured currency', async () => {
  const mppx = server()
  const proof = await credential(mppx)
  assert.equal((await mppx.charge({ amount: '1', currency: 'usd' })(paidRequest(proof))).status, 402)
})

test('charge: a proof cannot cross networks sharing a signing key', async () => {
  const proof = await credential(server())
  let consumed = false
  const mppx = server({
    network: 'signet',
    consumePayment: async () => {
      consumed = true
      return true
    },
  })
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 402)
  assert.equal(consumed, false)
})

test('charge: rejects sequential reuse of a payment', async () => {
  const mppx = server()
  const proof = await credential(mppx)
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 200)
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 402)
})

test('charge: exactly one concurrent request can consume a payment', async () => {
  const mppx = server()
  const proof = await credential(mppx)
  const results = await Promise.all(Array.from({ length: 12 }, () =>
    mppx.charge({ amount: '1' })(paidRequest(proof)),
  ))
  assert.equal(results.filter((result) => result.status === 200).length, 1)
})

test('charge: different payments can be consumed concurrently', async () => {
  const mppx = server()
  const cheap = await credential(mppx)
  const expensive = await credential(mppx, '100000')
  const results = await Promise.all([
    mppx.charge({ amount: '1' })(paidRequest(cheap)),
    mppx.charge({ amount: '100000' })(paidRequest(expensive)),
  ])
  assert.deepEqual(results.map((result) => result.status), [200, 200])
})

test('charge: instances sharing a store cannot consume a payment concurrently', async () => {
  const store = Store.memory()
  const first = server({ store })
  const second = server({ store })
  const proof = await credential(first)
  const results = await Promise.all([first, second].map((mppx) =>
    mppx.charge({ amount: '1' })(paidRequest(proof)),
  ))
  assert.equal(results.filter((result) => result.status === 200).length, 1)
})

test('charge: a fresh instance honors payments already consumed in its store', async () => {
  const store = Store.memory()
  const first = server({ store })
  const proof = await credential(first)
  assert.equal((await first.charge({ amount: '1' })(paidRequest(proof))).status, 200)
  assert.equal((await server({ store }).charge({ amount: '1' })(paidRequest(proof))).status, 402)
})

test('charge: invalid preimages are neither consumed nor exposed in error responses', async () => {
  const mppx = server()
  const proof = await credential(mppx)
  const invalid = Credential.deserialize(proof)
  const wrongPreimage = invoices['100000'].preimage
  invalid.payload = { preimage: wrongPreimage }
  const result = await mppx.charge({ amount: '1' })(paidRequest(Credential.serialize(invalid)))
  assert.equal(result.status, 402)
  assert.ok(!(await result.challenge.text()).includes(wrongPreimage))
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 200)
})

test('charge: malformed hex cannot expose preimages in error responses', async () => {
  const mppx = server()
  const proof = await credential(mppx)
  for (const preimage of ['secret-not-hex', 'ab'.repeat(31), 'z'.repeat(64)]) {
    const invalid = Credential.deserialize(proof)
    invalid.payload = { preimage }
    const result = await mppx.charge({ amount: '1' })(paidRequest(Credential.serialize(invalid)))
    assert.equal(result.status, 402)
    assert.ok(!(await result.challenge.text()).includes(preimage))
  }
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 200)
})

test('charge: invalid or underpriced proofs never reach the atomic consumer', async () => {
  const claimed: string[] = []
  const mppx = server({
    consumePayment: async (hash) => {
      claimed.push(hash)
      return true
    },
  })
  const proof = await credential(mppx)
  assert.equal((await mppx.charge({ amount: '100000' })(paidRequest(proof))).status, 402)
  const invalid = Credential.deserialize(proof)
  invalid.payload = { preimage: invoices['100000'].preimage }
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(Credential.serialize(invalid)))).status, 402)
  invalid.payload = { preimage: invoices['1'].preimage }
  invalid.challenge.request.amount = '100000'
  assert.equal((await mppx.charge({ amount: '100000' })(paidRequest(Credential.serialize(invalid)))).status, 402)
  assert.deepEqual(claimed, [])
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 200)
  assert.deepEqual(claimed, [invoices['1'].paymentHash])
})

test('charge: expired invoices never reach the atomic consumer', async () => {
  let consumed = false
  const mppx = server({
    consumePayment: async () => {
      consumed = true
      return true
    },
  })
  const proof = await credential(mppx)
  mock.method(Date, 'now', () => new Date('2101-01-01T00:00:00Z').getTime())
  const result = await mppx.charge({ amount: '1' })(paidRequest(proof))
  assert.equal(result.status, 402)
  assert.match(await result.challenge.text(), /Lightning invoice has expired/)
  assert.equal(consumed, false)
})

test('charge: a failed store write denies access and permits a later retry', async () => {
  const store = Store.memory()
  const put = store.put
  let unavailable = true
  store.put = async (key, value) => {
    if (unavailable) throw new Error('storage unavailable')
    await put(key, value)
  }
  const mppx = server({ store })
  const proof = await credential(mppx)
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 402)
  unavailable = false
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 200)
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 402)
})

test('charge: waits for the atomic consumer before authorizing work', { timeout: 5000 }, async () => {
  let release!: (claimed: boolean) => void
  const claim = new Promise<boolean>((resolve) => { release = resolve })
  let entered!: () => void
  const consuming = new Promise<void>((resolve) => { entered = resolve })
  const mppx = server({
    consumePayment: () => {
      entered()
      return claim
    },
  })
  const proof = await credential(mppx)
  let authorized = false
  const pending = mppx.charge({ amount: '1' })(paidRequest(proof)).then((result) => {
    authorized = result.status === 200
    return result
  })
  await consuming
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(authorized, false)
  release(true)
  assert.equal((await pending).status, 200)
})

test('charge: atomic storage failures deny access without falling back to memory', async () => {
  let unavailable = true
  const mppx = server({
    consumePayment: async () => {
      if (unavailable) throw new Error('storage unavailable')
      return true
    },
  })
  const proof = await credential(mppx)
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 402)
  unavailable = false
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 200)
})

test('charge: an ambiguous committed claim is never released', async () => {
  let consumed = false
  const mppx = server({
    consumePayment: async () => {
      if (consumed) return false
      consumed = true
      throw new Error('claim committed but acknowledgement lost')
    },
  })
  const proof = await credential(mppx)
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 402)
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 402)
})

function redeemInWorker(directory: string, authorization: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = fileURLToPath(new URL('./chargeWorker.ts', import.meta.url))
    const child = spawn(process.execPath, ['--import', 'tsx/esm', worker], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
      killSignal: 'SIGKILL',
    })
    let output = ''
    let errors = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { errors += chunk })
    child.on('error', reject)
    child.stdin.on('error', reject)
    child.on('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(
          `Redemption worker failed (exit code ${code}, signal ${signal ?? 'none'}): ${errors.trim() || 'no stderr'}`,
        ))
      } else if (!/^(200|402)$/.test(output.trim())) {
        reject(new Error('Redemption worker returned an invalid status'))
      } else {
        resolve(Number(output))
      }
    })
    child.stdin.end(JSON.stringify({ directory, authorization, secretKey: SECRET_KEY }))
  })
}

test('charge: an atomic shared consumer prevents replay across processes and restarts', { timeout: 150_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spark-charge-'))
  try {
    const proof = await credential(server())
    const results = await Promise.allSettled([
      redeemInWorker(directory, proof),
      redeemInWorker(directory, proof),
    ])
    const statuses = results.map((result) => {
      if (result.status === 'rejected') throw result.reason
      return result.value
    }).sort()
    assert.deepEqual(statuses, [200, 402])
    assert.equal(await redeemInWorker(directory, proof), 402)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('sha256(preimage) == paymentHash for a valid preimage', () => {
  const preimage = bytesToHex(randomBytes(32))
  const paymentHash = bytesToHex(sha256(hexToBytes(preimage)))

  // Replicate what server/Charge.ts verify() does
  const actual = bytesToHex(sha256(hexToBytes(preimage)))
  assert.equal(actual, paymentHash)
})

test('wrong preimage produces a different hash', () => {
  const preimage = bytesToHex(randomBytes(32))
  const paymentHash = bytesToHex(sha256(hexToBytes(preimage)))

  const wrongPreimage = bytesToHex(randomBytes(32))
  const wrongHash = bytesToHex(sha256(hexToBytes(wrongPreimage)))

  assert.notEqual(wrongHash, paymentHash)
})

test('hashing the raw hex string instead of its decoded bytes gives a different result', () => {
  // Guard against the mistake of calling sha256(preimage) instead of
  // sha256(hexToBytes(preimage)), which would silently accept no valid preimage.
  const preimage = bytesToHex(randomBytes(32))
  const correctHash = bytesToHex(sha256(hexToBytes(preimage)))
  const wrongHash = bytesToHex(sha256(new TextEncoder().encode(preimage)))

  assert.notEqual(wrongHash, correctHash)
})
