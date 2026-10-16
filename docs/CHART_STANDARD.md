# Standardized chart of accounts (loan & inter-entity accounts)

Goal: one reserved account **number** per related party, used **identically in
every company**, with a strict **"Due to" / "Due from" mirror** so tie-outs are
exact and matching keys off the counterparty instead of fuzzy names.

Convention (standard everywhere): `1xxx` = assets (owed TO you), `2xxx` =
liabilities (you OWE), `3xxx` equity, `4xxx` income, `5xxx`+ expenses.

Decision baked in (change if wrong): **Sonic Stroesser Properties is a sole
prop = Chris personally**, so "SSP" and "Chris Stroesser" are ONE party. Each
corp carries a single shareholder-loan account for him.

**Naming rule (confirmed):** a bare **"Sonic"** on an account means the **sole
prop (SSP/Chris)**, NOT the corporation. The corporation is always written
**"Sonic Systems AV Ltd."** So "Notes Payable – Sonic" = owed to Chris/SSP →
shareholder loan (2230), not an inter-corp account. In practice the corps borrow
from Chris, not from each other, so corp-to-corp accounts are rarely used.

---

## Reserved numbers (same in all companies)

### Assets — money owed TO this company (1200s "Due from")
| #    | Name                              |
|------|-----------------------------------|
| 1210 | Due from 1933230 Ontario Inc.     |
| 1220 | Due from Sonic Systems AV Ltd.    |
| 1230 | Due from Chris Stroesser (SSP)    |
| 1240 | Due from Kevin                    |
| 1250 | Due from Susan Shephard (Nissan)  |

### Liabilities — money this company OWES (2200s "Due to" / loans)
| #    | Name                                   |
|------|----------------------------------------|
| 2210 | Due to 1933230 Ontario Inc.            |
| 2220 | Due to Sonic Systems AV Ltd.           |
| 2230 | Shareholder loan – Chris Stroesser (SSP) |
| 2240 | Note payable – Aidan                   |
| 2250 | Note payable – Elettia                 |
| 2260 | CEBA loan                              |
| 2270 | Mortgage payable – 88 King St (Albert) |

**Mirror rule:** Company X's `22x0 Due to Y` must be equal-and-opposite to
Company Y's `12x0 Due from X`. If one side moves, the other must too.

---

## Per-company mapping (from the balance sheets)

### 1933230 Ontario Inc. (King corp)
| Current account              | → Standard                                   | Note |
|------------------------------|----------------------------------------------|------|
| 88 King St. Mortgage Principal | 2270 Mortgage payable – 88 King St (Albert) | the legal mortgage |
| NOTES PAYABLE CHRIS          | 2230 Shareholder loan – Chris Stroesser (SSP)| merge w/ Stroesser Money In |
| STROESSER MONEY IN           | 2230 Shareholder loan – Chris Stroesser (SSP)| **merge into 2230** |
| NOTES PAYABLE SONIC          | 2230 Shareholder loan – Chris Stroesser (SSP)| bare "Sonic" = sole prop → merge into 2230 |
| NOTES PAYABLE AIDAN          | 2240 Note payable – Aidan                    | |
| NOTES PAYABLE ELETTIA        | 2250 Note payable – Elettia                  | |
| *(missing)*                  | 2230 should hold ~**$112,412** to mirror SSP | **the big gap** |

### Sonic Stroesser Properties (SSP, sole prop)
| Current account                  | → Standard                       | Note |
|----------------------------------|----------------------------------|------|
| 1092 DUE FROM 1933230 ONTARIO INC. | 1210 Due from 1933230 Ontario Inc. | ~$112,412 |
| 1601 88 KING ASSET               | 1210 Due from 1933230 (or keep as property-loan) | reconcile vs 1210 |
| 1091 DUE FROM KEVIN              | 1240 Due from Kevin              | |
| 1095 SUSAN SHEPHARD NISSAN LOAN  | 1250 Due from Susan Shephard (Nissan) | |

### Sonic Systems AV Ltd.
| Current account                 | → Standard                                    | Note |
|---------------------------------|-----------------------------------------------|------|
| Long term borrowings – CHRIS    | 2230 Shareholder loan – Chris Stroesser (SSP) | merge |
| Notes Payable – Chris Stroesser | 2230 Shareholder loan – Chris Stroesser (SSP) | **merge** (holds the $2,449.88 SSP↔AV gap) |
| Notes Payable – Sonic           | 2230 Shareholder loan – Chris Stroesser (SSP) | bare "Sonic" = sole prop → merge into 2230 |
| CEBA                            | 2260 CEBA loan                                | |
| LOAN PAYABLE – ALBERT           | 2230 Shareholder loan – Chris Stroesser (SSP) | **stale** — Albert's only current loan is the King mortgage; this was Chris's personal debt, so corp payments on it are draws → reclassify to 2230 and verify the –$34,000 |

---

## Two phases
1. **Structure (safe now):** renumber/rename to the standard and merge the
   duplicate "Chris / Sonic / Stroesser" accounts into 2230. This moves
   existing entries only — no balances are invented, nothing is lost.
2. **Balance corrections (need review first):** adding the missing mirror
   entries (e.g. the ~$112k on 1933230) changes totals and waits on Chris's
   review of the King St side.

## Known issues to fix during standardization
- **SSP↔1933230 ($111,932) — pending King St review:** SSP shows 1210 Due from
  1933230 ≈ $112,412, but 1933230 has no matching ~$112k in 2230 (only
  "Stroesser Money In" $750). Add the mirror once Chris confirms the true
  balance.
- **SSP↔AV ($2,449.88):** = AV's "Notes Payable – Chris Stroesser" (–$2,449.88);
  needs the SSP-side mirror.
- **Backwards (debit) liability balances** to investigate: Albert –$34,000,
  Notes Payable Sonic –$5,651, Chris Stroesser –$2,449. A liability shouldn't be
  negative — overpayment or miscoding.
- **"Sonic" = sole prop (confirmed):** every bare "Sonic" account is owed to
  Chris/SSP → 2230, not the AV corp.
- **AV "Loan Payable – Albert" (–$34,000):** stale personal debt; reclassify to
  2230 and confirm the negative balance.

## How to apply (in the app)
Chart of Accounts → hover an account → **pencil** → edit its number/name/type,
or **Merge** it into another to consolidate duplicates. All changes are audited
and reversible; entries keep their amounts, so transactions stay balanced.
