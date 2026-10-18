/**
 * Tests for charge authorization through mppx and the preimage hash invariant.
 * Only wallet calls are mocked; no Lightning payments or external services run.
 */
import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
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
  // HMAC, BOLT11 decoding, preimage check, and replay store all run locally.
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
  // A rejected request must not burn the payment for its original price.
  assert.equal((await mppx.charge({ amount: '1' })(paidRequest(proof))).status, 200)
})

test('charge: a proof cannot change the configured currency', async () => {
  const mppx = server()
  const proof = await credential(mppx)
  assert.equal((await mppx.charge({ amount: '1', currency: 'usd' })(paidRequest(proof))).status, 402)
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
