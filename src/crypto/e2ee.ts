export type EncryptedPayload = {
  iv: string
  ciphertext: string
}

export type Identity = {
  privateKey: CryptoKey
  publicKey: CryptoKey
  publicJwk: JsonWebKey
}

export type KeyBackup = {
  salt: string
  iv: string
  ciphertext: string
}

/** True when two public JWKs describe the same P-256 point. */
export function samePublicJwk(
  a: JsonWebKey | null | undefined,
  b: JsonWebKey | null | undefined,
): boolean {
  if (!a || !b) return false
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y
}

const curve = { name: 'ECDH', namedCurve: 'P-256' } as const

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function randomId(): string {
  const c = crypto as Crypto & { randomUUID?: () => string }
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createIdentity(): Promise<Identity> {
  const pair = await crypto.subtle.generateKey(curve, true, ['deriveBits'])
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicJwk,
  }
}

export function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, curve, true, [])
}

export async function deriveSharedKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  )
  return crypto.subtle.importKey(
    'raw',
    bits,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptText(
  text: string,
  key: CryptoKey,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(text)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  )
  return {
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  }
}

export async function decryptText(
  payload: EncryptedPayload,
  key: CryptoKey,
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) as BufferSource },
    key,
    fromBase64(payload.ciphertext) as BufferSource,
  )
  return new TextDecoder().decode(decrypted)
}

export async function decryptTextWithAny(
  payload: EncryptedPayload,
  keys: CryptoKey[],
): Promise<string | null> {
  for (const key of keys) {
    try {
      return await decryptText(payload, key)
    } catch {
      continue
    }
  }
  return null
}

async function backupWrappingKey(password: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(salt) as BufferSource, iterations: 210000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Wrap the device's ECDH private key with the account password. The server only ever sees ciphertext. */
export async function backupPrivateKey(
  privateJwk: JsonWebKey,
  password: string,
): Promise<KeyBackup> {
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)))
  const payload = await encryptText(JSON.stringify(privateJwk), await backupWrappingKey(password, salt))
  return { salt, iv: payload.iv, ciphertext: payload.ciphertext }
}

/** Unwrap a stored private key. Returns null on a wrong password or corrupt backup. */
export async function restorePrivateKey(
  backup: KeyBackup,
  password: string,
): Promise<JsonWebKey | null> {
  if (!backup || typeof backup.salt !== 'string' || typeof backup.iv !== 'string' || typeof backup.ciphertext !== 'string') {
    return null
  }
  try {
    const json = await decryptText(
      { iv: backup.iv, ciphertext: backup.ciphertext },
      await backupWrappingKey(password, backup.salt),
    )
    const jwk = JSON.parse(json) as JsonWebKey
    return jwk && typeof jwk === 'object' && typeof jwk.d === 'string' ? jwk : null
  } catch {
    return null
  }
}
