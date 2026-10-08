/**
 * PKCE (RFC 7636) + OAuth state helpers, using Web Crypto.
 *
 * PKCE lets a public client (an app that can't keep a secret) complete the OAuth
 * authorization-code flow safely: we send a hashed `code_challenge` up front, then
 * prove possession of the original `code_verifier` at token exchange.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** High-entropy code verifier (43–128 chars of the unreserved set). */
export function createCodeVerifier(): string {
  // 32 random bytes → 43 base64url chars, within the RFC length bounds.
  return base64UrlEncode(randomBytes(32))
}

/** S256 challenge = BASE64URL(SHA-256(verifier)). */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

/** Opaque anti-CSRF state value returned on the OAuth redirect and checked for equality. */
export function createState(): string {
  return base64UrlEncode(randomBytes(16))
}

export interface PkcePair {
  verifier: string
  challenge: string
  state: string
}

/** Create a verifier + its S256 challenge + a fresh state in one step. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = createCodeVerifier()
  const challenge = await codeChallengeS256(verifier)
  return { verifier, challenge, state: createState() }
}
