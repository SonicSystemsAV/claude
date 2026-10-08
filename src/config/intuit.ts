/**
 * Intuit / QuickBooks Online OAuth + API configuration.
 *
 * The Client ID is a PUBLIC identifier for a PKCE public client — safe to live in
 * the frontend bundle. The Client SECRET must NEVER appear here or anywhere in the
 * shipped app; token exchange happens Rust-side (Tauri) or via a small proxy.
 *
 * Values come from .env.local (VITE_INTUIT_CLIENT_ID / VITE_INTUIT_ENV), which is
 * gitignored. isConfigured() lets the UI degrade gracefully when no key is present.
 */

export type IntuitEnv = 'sandbox' | 'production'

const clientId = (import.meta.env.VITE_INTUIT_CLIENT_ID as string | undefined) ?? ''
const environment = ((import.meta.env.VITE_INTUIT_ENV as string | undefined) ?? 'sandbox') as IntuitEnv

export const INTUIT = {
  clientId,
  environment,

  /** Accounting scope is all we need; add openid/profile/email only to show who connected. */
  scopes: ['com.intuit.quickbooks.accounting'] as const,

  /** Desktop shell listens on http://localhost:<port><redirectPath>; port is chosen at runtime. */
  redirectPath: '/callback',

  /** OAuth 2.0 endpoints (same for sandbox + production). */
  authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
  tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  revokeUrl: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',

  /** QBO API base differs by environment. */
  get apiBase(): string {
    return environment === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com'
  },

  /** QBO minor version pinned so report/response shapes are stable across our build. */
  minorVersion: 75,

  isConfigured(): boolean {
    return clientId.trim().length > 0
  },
} as const

/** Build the Intuit authorize URL for a given redirect URI, PKCE challenge and state. */
export function buildAuthorizeUrl(params: {
  redirectUri: string
  codeChallenge: string
  state: string
}): string {
  const q = new URLSearchParams({
    client_id: INTUIT.clientId,
    response_type: 'code',
    scope: INTUIT.scopes.join(' '),
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${INTUIT.authorizeUrl}?${q.toString()}`
}
