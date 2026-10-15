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
