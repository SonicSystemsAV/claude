/**
 * QuickBooks Online "live" connector — the in-app OAuth + API-import path.
 *
 * Mirrors the Square connector's shape but imports a whole company (like the
 * CSV Journal path): it pulls the General Ledger report + the chart of accounts
 * over the Intuit API (through the Tauri `qbo_*` Rust commands, since Intuit's
 * API has no CORS and the client secret must stay off the web context), then
 * funnels them through the existing parseGeneralLedger → importQBOData engine
 * so the resulting books are identical to every other source.
 *
 * Desktop-only. See docs/QUICKBOOKS_AND_DATA_FILES.md for the full design.
 */

import { isTauri } from '../lib/desktop'
import { importFromGeneralLedger, type QBOImportSummary } from './qboImport'
import type { QBOReport } from './qboGeneralLedger'

const QBO_MINOR_VERSION = '70'

export interface QboConfig {
  /** Intuit app Client ID. */
  clientId: string
  /** Intuit app Client Secret (the user's own app; stays on-device). */
  clientSecret: string
  environment: 'sandbox' | 'production'
  /** Loopback redirect port; must match the redirect URI registered at Intuit. Default 8788. */
  redirectPort?: number
}

export interface QboTokens {
  accessToken: string
  refreshToken?: string
  /** The connected company (QBO realm) id — on every API call. */
  realmId: string
  expiresAt?: string
}

export const QBO_DEFAULT_REDIRECT_PORT = 8788

export interface QboConnectStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  realmId?: string | null
  error?: string | null
}

interface QboTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  realm_id?: string
}

export class QuickBooksConnector {
  private tokens: QboTokens | null = null
  private state: QboConnectStatus = { state: 'disconnected' }
  private onTokens?: (t: QboTokens) => void

  constructor(private config: QboConfig) {}

  status(): QboConnectStatus {
    return this.state
  }

  onTokensChanged(cb: (t: QboTokens) => void): void {
    this.onTokens = cb
  }

  tokensSnapshot(): QboTokens | null {
    return this.tokens
  }

  setTokens(tokens: QboTokens): void {
    this.tokens = tokens
    this.state = { state: 'connected', realmId: tokens.realmId, error: null }
  }

  get redirectUri(): string {
    return `http://localhost:${this.config.redirectPort ?? QBO_DEFAULT_REDIRECT_PORT}/callback`
  }

  private store(res: QboTokenResponse, realmId: string): void {
    const expiresAt = res.expires_in ? new Date(Date.now() + res.expires_in * 1000).toISOString() : undefined
    this.tokens = {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? this.tokens?.refreshToken,
      realmId,
      expiresAt,
    }
    this.state = { state: 'connected', realmId, error: null }
    this.onTokens?.(this.tokens)
  }

  async connect(): Promise<QboConnectStatus> {
    if (!isTauri()) {
      this.state = { state: 'error', error: 'Connecting to QuickBooks requires the desktop app (OAuth needs a local redirect listener and CORS-free HTTP).' }
      return this.state
    }
    if (!this.config.clientId.trim() || !this.config.clientSecret.trim()) {
      this.state = { state: 'error', error: 'Enter your QuickBooks Client ID and secret first.' }
      return this.state
    }
    this.state = { state: 'connecting' }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const res = await invoke<QboTokenResponse>('qbo_oauth', {
        clientId: this.config.clientId.trim(),
        clientSecret: this.config.clientSecret.trim(),
        redirectPort: this.config.redirectPort ?? QBO_DEFAULT_REDIRECT_PORT,
      })
      if (!res.realm_id) throw new Error('QuickBooks did not return a company id (realmId).')
      this.store(res, res.realm_id)
    } catch (e) {
      this.state = { state: 'error', error: e instanceof Error ? e.message : String(e) }
    }
    return this.state
  }

  disconnect(): void {
    this.tokens = null
    this.state = { state: 'disconnected' }
  }

  async refreshTokens(): Promise<void> {
    if (!this.tokens?.refreshToken) throw new Error('No QuickBooks refresh token to refresh with.')
    const { invoke } = await import('@tauri-apps/api/core')
    const res = await invoke<QboTokenResponse>('qbo_oauth_refresh', {
      clientId: this.config.clientId.trim(),
      clientSecret: this.config.clientSecret.trim(),
      refreshToken: this.tokens.refreshToken,
    })
    this.store(res, this.tokens.realmId)
  }

  private async ensureFreshToken(): Promise<void> {
    const exp = this.tokens?.expiresAt ? Date.parse(this.tokens.expiresAt) : NaN
    if (!Number.isNaN(exp) && exp - Date.now() < 120_000 && this.tokens?.refreshToken && this.config.clientSecret.trim()) {
      await this.refreshTokens()
    }
  }

  private async api<T>(path: string): Promise<T> {
    if (!this.tokens) throw new Error('Not connected to QuickBooks. Run Connect first.')
    await this.ensureFreshToken()
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>('qbo_api', { environment: this.config.environment, accessToken: this.tokens.accessToken, path })
  }

  /** Chart of accounts → name → QBO AccountType, for the GL parser's type hints. */
  async fetchAccountTypes(): Promise<Map<string, string>> {
    const realm = this.requireRealm()
    const query = encodeURIComponent('select * from Account maxresults 1000')
    const res = await this.api<{ QueryResponse?: { Account?: { Name: string; AccountType?: string }[] } }>(
      `/v3/company/${realm}/query?query=${query}&minorversion=${QBO_MINOR_VERSION}`,
    )
    const map = new Map<string, string>()
    for (const a of res.QueryResponse?.Account ?? []) {
      if (a.Name && a.AccountType) map.set(a.Name, a.AccountType)
    }
    return map
  }

  /** Pull the General Ledger report JSON for a date range (yyyy-mm-dd). */
  async fetchGeneralLedger(start: string, end: string): Promise<QBOReport> {
    const realm = this.requireRealm()
    return this.api<QBOReport>(
      `/v3/company/${realm}/reports/GeneralLedger?start_date=${start}&end_date=${end}&columns=tx_date,txn_type,doc_num,name,memo,account_name,subt_nat_amount&minorversion=${QBO_MINOR_VERSION}`,
    )
  }

  /** Pull accounts + GL for the range and import them as a new company. */
  async importRange(companyName: string, start: string, end: string): Promise<QBOImportSummary> {
    const [accountTypes, report] = await Promise.all([this.fetchAccountTypes(), this.fetchGeneralLedger(start, end)])
    return importFromGeneralLedger({ companyName, report, accountTypes })
  }

  private requireRealm(): string {
    if (!this.tokens?.realmId) throw new Error('Not connected to QuickBooks.')
    return this.tokens.realmId
  }
}

export function createQuickBooksConnector(config: QboConfig): QuickBooksConnector {
  return new QuickBooksConnector(config)
}
