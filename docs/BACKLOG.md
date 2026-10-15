# Backlog

Deferred feature requests, captured so they survive across revisions. Not yet started.

## Dashboard: period selector + drill-through
- Add a **period selector** to the Dashboard (and ideally reuse it across reports):
  YTD, This month, Last month, This quarter, Last quarter, This year, Last year,
  All dates, and a custom date range. The stat cards (Income, Expenses, Net,
  Cash) and the P&L panel should recompute for the chosen period.
- Make each stat card **clickable → drill-through** to the report that details
  that figure (e.g. Expenses card → P&L / expense detail filtered to the same
  period; Cash → bank account detail; To reconcile → the reconcile list, which
  it already links to).
- Implementation notes:
  - `profitAndLoss()` / `companyOverview()` in `src/db/repo.ts` currently compute
    all-time totals; they'd take optional `startDate`/`endDate` (getTransactions
    already supports a date range).
  - Respect the app-wide date-format setting (`src/lib/format.ts`).
  - Persist the last-chosen period (per the existing localStorage pattern).

## Product vision — "everything QuickBooks pretends to be"
Goal: simple to use, accurate, and easy to find & fix issues. Recommended
build order:

1. **Agentic AI assistant** (in progress). Context-aware chat that *proposes
   actions you approve* — categorize in bulk/specific, create ignore rules,
   match transfers, explain numbers. Tool-use loop over the app's own
   primitives; every write previewed, logged to the audit trail, reversible.
   Start on the Transfer Review queue, then general categorization.
2. **Review Center (unified issue inbox).** One cross-company worklist that
   aggregates every open issue: uncategorized txns, unreconciled bank items,
   unbalanced inter-company transfers, suspected duplicates, missing
   counterparties, tax mismatches. Becomes the assistant's home base.
3. **Health-check / validation engine.** Battery of accuracy checks feeding the
   Review Center: trial balance ≠ 0, sub-ledger vs GL drift, inter-company
   tie-outs (done), duplicate txns, future-dated anomalies, tax collected vs
   remitted, impossible balances, large MoM swings. Plus a weekly "top 5 to
   look at" brief.
4. **Categorization memory + bank import.** Remember payee→account decisions and
   auto-apply to past/future matches; OFX/CSV bank-feed import with auto-match.
5. **Findability.** "Explain this number" (click any figure → the txns behind it
   + plain-English explanation), drill-through everywhere, global search,
   duplicate-contact/account merge, split/reclassify.

Import hardening (partly done): also add duplicate-import detection and a
dry-run preview with control-total verification before committing an import.
