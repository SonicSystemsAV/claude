-- Ledgerly schema. All amounts are integer cents.
-- Double-entry: `transactions` header + signed `entries` that sum to zero.
-- Entry sign convention: amount_cents > 0 = DEBIT, < 0 = CREDIT.
-- An account's raw balance = SUM(amount_cents). For credit-normal accounts
-- (liability/equity/income) the display balance is the negation of that.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  legal_name     TEXT,
  base_currency  TEXT NOT NULL DEFAULT 'CAD',
  locked_through TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit','credit')),
  is_bank        INTEGER NOT NULL DEFAULT 0,
  parent_id      INTEGER REFERENCES accounts(id),
  archived       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('customer','supplier','both','other')),
  email         TEXT,
  phone         TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city          TEXT,
  province      TEXT,
  postal        TEXT,
  country       TEXT,
  website       TEXT,
  notes         TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, name)
);

-- Products & services used on itemized invoices, bills and expenses.
-- No inventory tracking: items are 'service' or 'non_inventory'. An item can be
-- sold (income account) and/or bought (expense account).
CREATE TABLE IF NOT EXISTS items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'service' CHECK (type IN ('service','non_inventory')),
  description        TEXT,
  sell               INTEGER NOT NULL DEFAULT 1,
  income_account_id  INTEGER REFERENCES accounts(id),
  sales_price_cents  INTEGER NOT NULL DEFAULT 0,
  buy                INTEGER NOT NULL DEFAULT 0,
  expense_account_id INTEGER REFERENCES accounts(id),
  cost_cents         INTEGER NOT NULL DEFAULT 0,
  taxable            INTEGER NOT NULL DEFAULT 1,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                 -- ISO yyyy-mm-dd
  memo        TEXT,
  reference   TEXT,
  contact_id  INTEGER REFERENCES contacts(id),
  status      TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','draft','void')),
  source      TEXT NOT NULL DEFAULT 'manual',-- manual | reconcile | import | seed
  deleted     INTEGER NOT NULL DEFAULT 0,     -- 1 = in the recycle bin
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  account_id     INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents   INTEGER NOT NULL,           -- +debit / -credit
  memo           TEXT
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),  -- the bank GL account
  date          TEXT NOT NULL,
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,            -- bank sign: +deposit / -withdrawal
  fitid         TEXT,                        -- OFX FITID for dedupe
  status        TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','ignored')),
  matched_txn_id INTEGER REFERENCES transactions(id),
  reconciliation_id INTEGER,
  imported_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A completed (or reopened) statement reconciliation for a bank account.
CREATE TABLE IF NOT EXISTS reconciliations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id           INTEGER NOT NULL REFERENCES accounts(id),
  statement_date       TEXT NOT NULL,
  ending_balance_cents INTEGER NOT NULL,
  cleared_count        INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reopened')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  reopened_at          TEXT
);

CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pattern     TEXT NOT NULL,
  match_kind  TEXT NOT NULL DEFAULT 'contains' CHECK (match_kind IN ('contains','regex','exact')),
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  priority    INTEGER NOT NULL DEFAULT 100,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Transactional documents (AR/AP): invoices, bills, expenses, sales receipts, payments.
CREATE TABLE IF NOT EXISTS documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('invoice','bill','expense','sales_receipt','payment_received','payment_made')),
  contact_id     INTEGER REFERENCES contacts(id),
  date           TEXT NOT NULL,
  due_date       TEXT,
  number         TEXT,
  memo           TEXT,
  tax_code_id    INTEGER,
  payment_method TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','void')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  balance_cents  INTEGER NOT NULL DEFAULT 0,   -- remaining unpaid (AR/AP docs)
  transaction_id INTEGER REFERENCES transactions(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  account_id       INTEGER NOT NULL REFERENCES accounts(id),
  item_id          INTEGER,
  description      TEXT,
  qty              REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents     INTEGER NOT NULL DEFAULT 0,
  taxable          INTEGER NOT NULL DEFAULT 1
);

-- Links a payment document to the invoice/bill it pays.
CREATE TABLE IF NOT EXISTS payment_applications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  applied_document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  amount_cents        INTEGER NOT NULL
);

-- Sales-tax codes (e.g. HST 13%, GST 5%, Zero-rated, Exempt).
CREATE TABLE IF NOT EXISTS tax_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  rate        REAL NOT NULL DEFAULT 0,         -- e.g. 0.13
  account_id  INTEGER REFERENCES accounts(id), -- tax liability account (null for 0% / exempt)
  is_default  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- User overrides for account -> tax-code mapping (GIFI and T2125). Auto-suggested
-- defaults are computed in code; only overrides are stored here.
CREATE TABLE IF NOT EXISTS tax_map (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  gifi_code   TEXT,
  t2125_line  TEXT,
  UNIQUE (company_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_company_type ON documents(company_id, type, status);
CREATE INDEX IF NOT EXISTS idx_document_lines_doc ON document_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_payapp_applied ON payment_applications(applied_document_id);

-- Links the two sides of an inter-company transaction (one txn in each company).
CREATE TABLE IF NOT EXISTS intercompany_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_txn_id     INTEGER REFERENCES transactions(id),
  to_company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  to_txn_id       INTEGER REFERENCES transactions(id),
  amount_cents    INTEGER NOT NULL,
  date            TEXT NOT NULL,
  memo            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Local user accounts with roles (admin / accountant / viewer).
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','accountant','viewer')),
  salt       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only audit trail of financial actions.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  action      TEXT NOT NULL,        -- create | update | void | payment | import | map
  entity      TEXT NOT NULL,        -- invoice | bill | expense | payment | account | rule | company | import | tax_map
  entity_id   INTEGER,
  user        TEXT,
  summary     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log(company_id, id);
CREATE INDEX IF NOT EXISTS idx_entries_txn ON entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_entries_account ON entries(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_company_date ON transactions(company_id, date);
CREATE INDEX IF NOT EXISTS idx_bank_company_status ON bank_transactions(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_fitid ON bank_transactions(company_id, account_id, fitid)
  WHERE fitid IS NOT NULL;
