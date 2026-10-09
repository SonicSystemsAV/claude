# Sonic the Ledgerhog — running & integration setup

Quick reference for running the app and turning on the three live integrations
(AI assistant, Square, QuickBooks). All three make network calls from the Tauri
**desktop** build (the browser can't, by design), so each needs the desktop app.

## Running

```bash
npm install
npm run dev          # browser dev build (UI only; live integrations disabled)
npm run tauri dev    # desktop app (required for all live integrations)
npm run tauri build  # installer + launchable icon → src-tauri/target/release/bundle/nsis/
```

- **Frontend-only change?** `git pull` hot-reloads under a running `tauri dev`.
- **Change under `src-tauri/` (Rust)?** Stop (Ctrl+C) and rerun `npm run tauri dev`
  so cargo recompiles. First Rust build takes several minutes.

## AI assistant

- Settings → **AI assistant (beta)**, or the coin button (bottom-right, every page).
- Needs an **Anthropic API key** (console.anthropic.com). A key scoped to a
  **workspace** works directly; an **org-scoped** key also needs the **Workspace ID**
  field. Key is stored on this device only.
- Pick a model (Opus best / Sonnet cheaper / Haiku cheapest). Each question spends
  your own Anthropic credits.

## Square (POS sales → books)

- Register an app at **developer.squareup.com**. Use **Sandbox** credentials first.
- In the app's **OAuth** settings, add the Redirect URL exactly:
  `http://localhost:8787/callback`
- Settings → **Connect to Square**: paste **Application ID** + **Application Secret**,
  choose Sandbox, **Connect** (browser consent opens), pick the deposit **bank account**
  and a date range, **Sync**.
- Posting model: each sale → income + tax; processing fee → expense; tip → **Tips
  Collected** (liability); refunds reverse the sale; payouts → a bank-register deposit
  (auto-matched for reconciliation). Tokens persist on this device; access tokens
  auto-refresh.
- Create sandbox test payments first (Square sandbox seller tools / API Explorer) or
  the sync returns nothing. Sandbox sometimes reports zero processing fees — that's a
  sandbox quirk, not a bug.

## QuickBooks Online (live import)

- Register an app at **developer.intuit.com** (QuickBooks Online and Payments). Use
  **Sandbox** first; **Production** requires Intuit's app review before other users can
  connect.
- Add the Redirect URI exactly: `http://localhost:8788/callback`
- Scope used: `com.intuit.quickbooks.accounting`.
- Settings → **Connect to QuickBooks (live)**: paste **Client ID** + **Client Secret**,
  choose Sandbox, **Connect**, enter a company name + date range, **Import**. It pulls the
  General Ledger + chart of accounts and rebuilds balanced double-entry as a new company
  (same engine as the CSV import).
- The CSV Journal import (Settings → **Import from QuickBooks**) needs no app and works
  in the browser too.

## Notes

- Secrets (Anthropic key, Square/Intuit client secrets, refresh tokens) are stored in
  this device's local storage only — never in the `.sonicledger` book file and never
  committed. A future hardening step is the OS secure store (Windows Credential Manager).
- Ports 8787 (Square) and 8788 (QuickBooks) are the loopback OAuth redirect listeners;
  they only open briefly during sign-in.
