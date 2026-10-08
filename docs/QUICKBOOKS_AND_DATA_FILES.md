# Sonic the Ledgerhog — In-app QuickBooks import & file-based company data

> App display name: **Sonic the Ledgerhog**. Book-set files use the extension **`.sonicledger`** (plain SQLite inside). Default folder: **`Documents/sonictheledgerhog/`**.

**Status:** design (pre-build) · **Target:** the Tauri desktop build that ships to other users · **Author:** design pass, Oct 2026

This covers two linked decisions:

1. **In-app "Connect to QuickBooks"** — so *any* copy of the installed app can import directly from the QuickBooks the end user signs into (not just Chris's session).
2. **Company data as real files** — books that live on local disk or a cloud-synced folder, not locked inside browser storage.

They're related: both require the **desktop (Tauri) shell** to own real OAuth connections and real files. The browser dev build can't do either safely on its own.

---

## Part A — Why the connector I used today is NOT shippable

What ran in this session (`list_companies`, `get_general_ledger`, …) is a **Claude-side connector** authenticated with Chris's Intuit login. It lives in the Claude session, not in Ledgerly. If I pull data with it, that's me loading *Chris's* books into *this* install. A different person who installs the app gets no QuickBooks button at all.

To ship the feature, **Ledgerly itself must be an Intuit-registered OAuth app.** Below is what that takes.

---

## Part B — In-app QuickBooks OAuth + import

### B1. What you (Chris) must do at Intuit — I can't do these

1. Create an app at **developer.intuit.com** → **My Apps** → *Create an app* → **QuickBooks Online and Payments**.
2. Record the **Client ID** (and Client Secret — see B3 about not shipping it).
3. Add a **Redirect URI** the desktop app will listen on. For a desktop PKCE flow the standard choice is a **loopback** URI:
   `http://localhost:<port>/callback` (Intuit allows http only for `localhost`). We can also register a custom scheme `ledgerly://callback` as backup.
4. Scopes we need: **`com.intuit.quickbooks.accounting`** (plus `openid profile email` only if we show who connected).
5. Start in the **Sandbox** (test company) for development. **Production** requires Intuit to review the app before other users can connect it — budget days–weeks for that approval. Until approved, only your own developer account's companies can connect.

> Net: sandbox build can be fully developed now; shipping to *other* users is gated on Intuit production approval.

### B2. The OAuth flow in a desktop app (PKCE)

```
App → opens system browser → Intuit sign-in / company picker
     → user approves
     → Intuit redirects to http://localhost:<port>/callback?code=…&realmId=…
     → app's tiny local listener catches it
     → app exchanges code (+ PKCE verifier) for access_token + refresh_token
     → store refresh_token in the OS secure store (Windows Credential Manager via Tauri)
     → access_token (1h) refreshed from refresh_token (100 days) as needed
realmId = the QBO company id, used on every API call.
```

PKCE (Proof Key for Code Exchange) is what lets a *public* client (an app we can't keep secrets in) do OAuth safely.

### B3. The client-secret problem — two options

A distributed `.exe` **cannot hold a client secret** (anyone can extract it). Two ways to handle Intuit's token exchange:

| Option | How | Trade-off |
|---|---|---|
| **B3a. Pure PKCE public client** | App does the token exchange directly; no secret stored. | Simplest, nothing to host. Works **if** Intuit treats the app as a public client for token exchange. Intuit's docs historically expect a secret at `/tokens/bearer`, so this must be verified against their current PKCE support. |
| **B3b. Tiny token-exchange proxy** (recommended fallback) | You host a ~50-line serverless function (e.g. Cloudflare Worker / Vercel) that holds the secret and does *only* the code→token and refresh calls. The app talks to your proxy, never to Intuit's token endpoint directly. | Keeps the secret off every installed machine; one small thing to host. Most robust for a shipped product. |

**Recommendation:** build the flow so the token-exchange URL is a config value — point it at Intuit directly if pure-PKCE works, or at your proxy if not. Decide after a 30-minute spike against Intuit's sandbox.

### B4. Calling the API — must go through Tauri's Rust HTTP, not the browser

QuickBooks' API does **not** send CORS headers, so a browser `fetch()` is blocked. The Tauri shell makes the HTTP request from **Rust** (no CORS), returns JSON to the React UI. So the import button only lights up in the **desktop build**; in the browser dev build it's disabled with "Desktop app required."

### B5. Which report to pull, and how we rebuild double-entry

- **Chart of accounts:** `Account` query / `search_accounts` → gives name, `AccountType`, `AcctNum`, active. Maps cleanly through the existing `mapAccountType()` in `src/db/qboImport.ts`.
- **Transactions:** the **General Ledger** (native JSON via the Reports API) lists every posting line under its account, and **each line carries its transaction id** (e.g. `"Payment","id":"6135"`). We **group lines by transaction id across all accounts** → each group is a balanced double-entry transaction. This reuses the exact "regroup into balanced entries" idea the CSV Journal importer already proves out.
  - Pull **year by year** (fiscal year windows) to keep each response bounded and show progress.
  - The compact projection drops money columns, so use the **native** report (`fetch_quickbooks_report` equivalent in-app) which includes Amount.
  - Penny rounding → the existing `QBO Import Rounding` account safety net already in `qboImport.ts`.
- **Validation:** after import, compare Ledgerly's trial balance to QBO's **Trial Balance** report for the same date. They must tie. Show the user a reconciliation summary.

### B6. Reusable import core

Refactor `src/db/qboImport.ts` so the balanced-entry builder is shared:

```
importQBOData({ companyName, accounts, transactions })   // structured, connector/API
importQBOJournal({ companyName, journalCsv, accountListCsv })  // CSV, calls the same core
```

Both end at the same `createCompany → createAccount → insert transactions/entries` path, so reports, tax, reconcile all work identically regardless of source.

### B7. Phased build

- **Phase 1 — scaffolding (no Intuit needed):** `importQBOData()` core + a structured JSON import path + a dev "import from file" hook, validated against a saved sample pulled in *this* session. Lets us prove the transform end-to-end now.
- **Phase 2 — OAuth (sandbox):** Tauri loopback listener, PKCE, token store, "Connect to QuickBooks" UI, token refresh.
- **Phase 3 — API pull + progress UI:** accounts + GL by year, regroup, import, trial-balance validation screen.
- **Phase 4 — production:** Intuit app review, proxy (if needed), error/\"subscription expired\" handling, disconnect/reconnect.

---

## Part C — Company data as real files (local or cloud)

### C1. Today vs. desired

- **Today:** one SQLite database held in the browser's **IndexedDB**; Settings can **Back up** (download a `.sqlite`) and **Restore** (upload one). The file is a manual export, and browser storage is the source of truth — invisible, per-browser, not something you can drop in OneDrive.
- **Desired:** the **file is the source of truth** — open from and save to a real path the user chooses: a local folder, or a cloud-synced folder (OneDrive / Dropbox / Google Drive). No cloud API required — the app writes an ordinary file; the user's existing cloud client syncs it.

### C2. Model: one book-set file, with per-company export

| Choice | Pros | Cons |
|---|---|---|
| **Single `.sonicledger` file holding all companies** (✅ CONFIRMED) | Inter-company linked transactions & the multi-company overview stay trivial; one thing to back up. | Sharing one company means sharing all — solved by per-company export below. |
| **One file per company** | Hand a single company to an accountant easily. | Inter-company links span files (fragile); more files to track. |

**Decision (confirmed with Chris):** one **book-set file** (`.sonicledger`, plain SQLite inside) as the working store **plus** "Export this company…" / "Import company from file…" for sharing a single entity. Back up / Restore keep working since it's just SQLite.

### C3. Desktop behaviour (Tauri)

- On the desktop build, the app reads/writes the real file via Tauri FS:
  - **Open book…** (native file picker) · **New book…** · **Save a copy…** · recent-files list.
  - **Autosave** writes back to the open file (debounced) and on close; a small "all changes saved" indicator.
  - Default location: **`Documents/sonictheledgerhog/`** — the user can point at `OneDrive/…/sonictheledgerhog/` so it syncs.
- **Cloud = a synced folder, not an integration.** We just need to be good about:
  - **Single-writer:** warn if the file changed on disk underneath us (cloud pulled a newer copy) before saving, to avoid clobbering.
  - Write to a temp file and atomically rename, so a sync mid-write can't corrupt the book.
- **Browser dev build:** keeps IndexedDB + manual Back up/Restore (no silent file access in a browser). Same SQLite format, so a file moves between the two freely.

### C4. Optional later: encryption at rest

Password-derived key (the login we just built is accountability, not encryption). A `.ledgerly` encrypted file matters most once books live in cloud folders. Flagged, not in the first cut.

### C5. Phases

- **Phase 1 (✅ BUILT):** desktop Open/New/Save-as against a real `.sonicledger` file + recent files + reopen-last-book on launch + autosave with atomic (temp-write→rename) writes + a live save-status indicator. Browser build falls back to Back up/Restore. Implementation: `src/lib/desktop.ts` (Tauri dialog/fs wrappers, all behind `isTauri()`), `db.ts` `createEmptyDatabase()` + `setPersistListener()`, store `openBookFile/openBookPath/newBookFile/saveBookAs` + `_scheduleBookWrite`, Settings "Book file" section. Rust: `tauri-plugin-dialog` + `tauri-plugin-fs` with `$HOME`/`$DOCUMENT` scope. Needs a desktop build to runtime-verify (can't test Tauri from the browser pane).
- **Phase 2:** external-change detection (file changed on disk underneath us — `fileMtimeMs()` helper already in place) with a reload/overwrite prompt.
- **Phase 3:** per-company export/import for sharing a single entity.
- **Phase 4:** optional encryption at rest.

> **Note on users per book:** the `users` table lives inside each book file, so opening a different book re-evaluates auth — if the current user isn't in that book (or the book is new/empty) the login/setup screen shows. This is intentional for v1.

---

## Open items for Chris

1. **Register the Intuit app** (B1) and send me the **Client ID** + redirect URI you want. Sandbox is enough to start.
2. Decide **B3a vs B3b** after a sandbox spike (I'll recommend based on what Intuit's PKCE actually allows).
3. ~~Confirm single book-set file + folder~~ — ✅ confirmed: one `.sonicledger` book-set in `Documents/sonictheledgerhog/`.
4. The import that works for *other* installer recipients is gated on **Intuit production approval** — worth starting that review early.
