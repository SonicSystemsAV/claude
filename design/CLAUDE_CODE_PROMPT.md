# Prompts for Claude Code

Paste these into your Ledgerly Claude Code session one at a time. Check the app between steps.

## 1. Theme and shell

> Read design/DESIGN.md. Add design/tailwind.sonic.js as a preset in tailwind.config.js and replace the font import and @layer components block in src/index.css with design/tokens.css. Copy design/assets/logo-dark.png and logo-light.png into src/assets. Rebuild the app shell (sidebar + main layout) to match design/screens/Dashboard.dc.html: black sidebar with the dark logo, entity select, lucide nav icons, active state and the Banking count pill. Don't change any data logic or routes. Then run typecheck.

## 2. Dashboard

> Restyle pages/Dashboard.tsx to match design/screens/Dashboard.dc.html: eyebrow + greeting, four KPI tiles, 12-month money in/out bar chart, the dark "Needs attention" panel, and the recent transactions table. Use real data for every figure; where the data isn't available yet, leave a clearly marked TODO rather than sample numbers.

## 3. Each remaining screen

> Restyle <page> to match design/screens/<Mockup>.dc.html using the component classes in tokens.css (btn-*, card, th/td, num, badge-*). Keep all existing fields and behaviour.

Order: Ledger → Journal → Reconcile → Invoices → Reports → Audit.

## 4. App icon

> Generate the Tauri app icons and replace ledgerly.ico from design/assets/coin-512.png, and use design/assets/favicon-64.png as the favicon in index.html.

## Keeping in sync

When the design changes, the files in /design get updated. Then: "Re-sync the UI with design/DESIGN.md and the changed screens in design/screens."
