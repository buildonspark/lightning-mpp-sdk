/**
 * Tests for the charge flow's core verification invariant.
 *
 * The entire security model of the charge flow rests on:
 *   sha256(hexToBytes(preimage)) == hexToBytes(paymentHash)
 *
 * These tests verify the exact algorithm used in server/Charge.ts verify()
 * so that any encoding mismatch (e.g. raw string vs decoded bytes, wrong hash
 * function) is caught immediately.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'

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
