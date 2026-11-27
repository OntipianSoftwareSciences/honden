import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backupPrivateKey,
  createIdentity,
  decryptText,
  deriveSharedKey,
  encryptText,
  restorePrivateKey,
  samePublicJwk,
} from '../src/crypto/e2ee'

const jwk = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' }

test('samePublicJwk matches the same public point', () => {
  assert.equal(samePublicJwk(jwk, { ...jwk }), true)
})

test('samePublicJwk rejects a different point, curve or missing key', () => {
  assert.equal(samePublicJwk(jwk, { ...jwk, x: 'other' }), false)
  assert.equal(samePublicJwk(jwk, { ...jwk, crv: 'P-384' }), false)
  assert.equal(samePublicJwk(jwk, null), false)
})

test('a backup wrapped with an older password cannot restore the key', async () => {
  const identity = await createIdentity()
  const privateJwk = await crypto.subtle.exportKey('jwk', identity.privateKey)
  const backup = await backupPrivateKey(privateJwk, 'old-password')
  assert.equal(await restorePrivateKey(backup, 'new-password'), null)
  assert.ok(await restorePrivateKey(backup, 'old-password'))
})

test('a mismatched stored key pair is rejected and a repaired key reads a new DM', async () => {
  const owner = await createIdentity()
  const other = await createIdentity()
  assert.equal(samePublicJwk(owner.publicJwk, other.publicJwk), false)

  const peer = await createIdentity()
  const senderKey = await deriveSharedKey(owner.privateKey, peer.publicKey)
  const readerKey = await deriveSharedKey(peer.privateKey, owner.publicKey)
  const wire = await encryptText('probe', senderKey)
  assert.equal(await decryptText(wire, readerKey), 'probe')

  const stalePeer = await createIdentity()
  const staleKey = await deriveSharedKey(owner.privateKey, stalePeer.publicKey)
  await assert.rejects(() => decryptText(wire, staleKey))
})
