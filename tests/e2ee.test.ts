import assert from 'node:assert/strict'
import test from 'node:test'
import { samePublicJwk } from '../src/crypto/e2ee'

const jwk = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' }

test('samePublicJwk matches the same public point', () => {
  assert.equal(samePublicJwk(jwk, { ...jwk }), true)
})

test('samePublicJwk rejects a different point, curve or missing key', () => {
  assert.equal(samePublicJwk(jwk, { ...jwk, x: 'other' }), false)
  assert.equal(samePublicJwk(jwk, { ...jwk, crv: 'P-384' }), false)
  assert.equal(samePublicJwk(jwk, null), false)
})
