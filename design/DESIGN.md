# Sonic the Ledgerhog: UI design spec

Brand and UI layer for the Ledgerly app (React 18 + Vite + Tailwind 3 + Tauri, lucide-react icons).
This folder is the source of truth for the look. Functionality, data and routing stay as they are.

## Files in /design

| Path | What it is |
|---|---|
| `DESIGN.md` | This spec |
| `tailwind.sonic.js` | Tailwind preset with every token below. Add it to `presets` in `tailwind.config.js` |
| `tokens.css` | Font import, CSS variables and the component classes (`.btn-*`, `.card`, `.badge-*`, `.nav-item`). Replaces the current teal component layer in `src/index.css` |
| `assets/logo-dark.png` | Full logo for dark backgrounds (white "sonic", orange "THE LEDGERHOG"). Use in the sidebar |
| `assets/logo-light.png` | Same logo for light backgrounds (black "sonic"). Use on printed invoices, reports, PDF exports |
| `assets/coin-512.png` | The Ledgerhog coin alone. App icon source (Tauri icons, .ico) |
| `assets/favicon-64.png` | Favicon |
| `screens/*.dc.html` | Reference mockups of each screen. Read them for layout, spacing, hierarchy and copy. They use a design-tool runtime (`support.js`, `<x-dc>`, `{{holes}}`, `<sc-for>`), so do not run or copy them as code. Rebuild as React + Tailwind |

## Colour tokens

| Token | Hex | Use |
|---|---|---|
| `sonic-black` | `#0B0B0B` | Sidebar, primary dark surfaces, secondary buttons |
| `sonic-orange` | `#F26A32` | Primary buttons, active nav icon, count pills, chart "money in", accents |
| `sonic-ember` | `#D05824` | Orange hover / pressed |
| `sonic-link` | `#B84A1A` | Links and any orange TEXT on light backgrounds |
| `sonic-link-hover` | `#8A3612` | Link hover |
| `ground` | `#F4F2EF` | App background |
| `surface` | `#FFFFFF` | Cards, tables, inputs |
| `rule` | `#E4E0DA` | Card borders, table header rule |
| `rule-soft` | `#EFECE7` | Table row dividers, progress tracks |
| `control` | `#CFC9C1` | Input and outline-button borders |
| `ink` | `#141312` | Body text |
| `muted` | `#5E5A55` | Secondary text, labels, table headers |
| `subtle` | `#9A958F` | Text on black (captions) |
| `nav-text` | `#D9D6D2` | Inactive sidebar items |
| `nav-active` | `#1F1D1B` | Active sidebar item background, cards inside dark panels |
| `nav-line` | `#2E2B28` | Borders inside the sidebar |
| `credit` / `credit-bg` | `#17695A` / `#E3F0EC` | Money in, "Matched", balanced state |
| `debit` / `debit-bg` | `#A8321E` / `#F6E1DE` | Money out, "Overdue" |
| `review-fg` / `review-bg` | `#8A3612` / `#FBE7DD` | "Review", "Partial", out-of-balance, selected row tint |
| `neutral-fg` / `neutral-bg` | `#4A4642` / `#EFECE7` | "Unposted", "Open", "Bank rule" |
| `chart-out` | `#3A3734` | Chart "money out" bars |

Contrast rules (these are not optional):
- Orange buttons take BLACK text (`#0B0B0B`). Never white on orange.
- Never use `#F26A32` as text on white; use `sonic-link` `#B84A1A`.
- Orange text is fine on black (sidebar, dark panels).

The existing `brand` Tailwind scale (teal) is remapped to orange in the preset so old `brand-*` classes don't break; migrate them to the named tokens over time.

## Typography

Google Fonts: Urbanist (300, 600), DM Sans (400, 500, 700), IBM Plex Mono (400, 500). Replaces Inter / JetBrains Mono.

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Page title (h1) | Urbanist | 40px / 300 | letter-spacing -0.5px |
| Section title (h2) | Urbanist | 18–20px / 600 | |
| Eyebrow above h1 | DM Sans | 13px / 400 | uppercase, tracking 1.2px, `muted`. e.g. "Sonic AV Corp · October 2026" |
| Body / UI | DM Sans | 15px / 400–500 | |
| Table body | DM Sans | 14px | |
| Table header | DM Sans | 12px / 500 | uppercase, tracking 1px, `muted` |
| Figures, amounts, dates, refs, account codes | IBM Plex Mono | 13–14px in tables, 28px / 500 for KPI tiles | `font-variant-numeric: tabular-nums`, right-aligned |

## Shape and spacing

- Radius: cards 14px, buttons and inputs 10px, nav items and table-cell inputs 8px, badges 6px, pills 11px (full).
- Card: white, 1px `rule` border, no shadow, padding 20–24px.
- Page padding 32px top, 40px sides; gaps 16px between cards, 24–28px between page sections.
- Touch targets: every button, link-button and input is at least 44px tall (40px allowed inside tables).

## Components

- **Primary button** (`.btn-primary`): orange bg, black text, 700, min-h 44px, px 18px. Hover: `sonic-ember`.
- **Secondary button** (`.btn-dark`): black bg, white text, 500.
- **Outline button** (`.btn-outline`): white bg, `control` border, ink text, 500.
- **Disabled primary**: bg `rule`, text `#6E6963` (e.g. "Post entry" while a journal entry is out of balance).
- **Badges** (`.badge-*`): 12px / 700, padding 4px 8px, radius 6px; colours from the status tokens above.
- **Sidebar**: 240px, `sonic-black`, padding 28px 16px. Logo (`logo-dark.png`, max-width 220px) at top, then an Entity select (dark input `#161514`, border `nav-line`), then nav items. Nav item: 44px tall, icon 18px stroke 1.8, gap 12px. Active item: `nav-active` bg, white text 500, icon stroked orange, `aria-current="page"`. Banking item carries an orange count pill with black text. Footer: user name + fiscal year end, top border `nav-line`.
- **Layout**: root is a `flex-wrap` row: sidebar `flex: 1 1 240px`, main `flex: 999 1 560px; min-width: 0`, so the sidebar stacks on narrow windows. Wide tables sit in an `overflow-x: auto` box.
- **KPI tile**: label 14px `muted`, value Plex Mono 28px / 500, note 13px (credit/review colour when it's good/bad news).
- **Dark panel** ("Needs attention", "Reviewer package"): `sonic-black` card, inner rows `nav-active`, numbers in orange Plex Mono.
- **Tabs / segmented control**: pill track `#E9E5E0`, selected segment white. Report tabs: black filled pill when selected, outline when not.

## Money display

- Negatives in parentheses, `debit` colour: `(6,218.40)`. Positives in `credit` colour, `+` prefix in activity lists.
- Debit column green-ish `credit` colour, credit column `debit` colour in registers (as mocked); running balance ink, 500.
- Always 2 decimals, en-CA grouping, CAD.
- Reconciled marker: `✓` in `credit`, unreconciled `○` in `subtle`.

## Icons (lucide-react)

Dashboard `LayoutDashboard`, General ledger `BookOpen`, Journal entries `PenLine`, Banking `Landmark`, Invoices & bills `FileText`, Reports `LineChart`, Audit trail `ShieldCheck`, Search `Search`, Add `Plus`. Stroke width 1.8 in nav, 2 in buttons.

## Screens (reference → existing page)

| Mockup | Purpose | Likely existing page |
|---|---|---|
| `Dashboard.dc.html` | Greeting, 4 KPI tiles, 12-month cash-flow bars, "Needs attention" dark panel, recent transactions | `pages/Dashboard.tsx` |
| `Ledger.dc.html` | Chart of accounts list (grouped, selectable) + register with filters, opening/closing balances, HST column, reconciled marker | `pages/Accounts.tsx` |
| `Journal.dc.html` | Entry header (date, type, reference, memo), line grid with live debit/credit totals, balanced/out-of-balance status bar, attachments | journal entry form |
| `Reconcile.dc.html` | Statement vs cleared vs difference tiles, progress bar, bank-feed rows with suggested match + confidence badge + Match / Categorize / Split | reconcile page (`db/reconcile.ts`, `db/matching.ts`) |
| `Invoices.dc.html` | A/R ⇄ A/P segmented toggle, aging bar + buckets, document list with status badges | `DocumentList.tsx` / `Purchases.tsx` |
| `Reports.dc.html` | Period / compare selectors, report pills (P&L, Balance sheet, HST summary), statement rendered as a document card | reports / `taxReports.ts` |
| `Audit.dc.html` | Fiscal-year cards with % documented, change history with before → after diffs, reviewer-package checklist | `pages/Audit.tsx` |
| `Brand.dc.html` | Logo lockups, palette, type and element samples | (reference only) |

Mockup figures and names are sample data. Wire every screen to real data; keep any screen or field the app has that the mockups don't show, styled with the same components.
