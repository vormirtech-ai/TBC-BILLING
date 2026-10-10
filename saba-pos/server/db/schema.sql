-- ---------------------------------------------------------------------------
-- Saba POS — schema
-- ---------------------------------------------------------------------------
-- An order is stored as one JSON document with its queryable fields lifted
-- into real columns.
--
-- That is a deliberate choice, not a shortcut. The whole domain — pricing,
-- the docket state machine, the reports — is written as pure functions over
-- a whole order object, and those functions are shared verbatim with the
-- browser. Shredding each order across six relational tables on the way in
-- and reassembling it on the way out would mean two models of the same thing
-- and two places for them to disagree. The columns below cover every query
-- the application actually makes; the document covers everything else.
-- ---------------------------------------------------------------------------

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- One row. Carries the revision every terminal watches for changes.
CREATE TABLE IF NOT EXISTS meta (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  revision      INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 0,
  installed_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  initials    TEXT NOT NULL,
  role        TEXT NOT NULL,
  pin_hash    TEXT NOT NULL,
  pin_salt    TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_active ON users (active);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  terminal    TEXT,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

-- Failed PIN attempts, so an account can be locked briefly after a run of them.
CREATE TABLE IF NOT EXISTS pin_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,
  address     TEXT NOT NULL,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pin_attempts_at ON pin_attempts (at);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  number        INTEGER NOT NULL,
  code          TEXT NOT NULL,
  business_day  TEXT NOT NULL,
  table_id      TEXT NOT NULL,
  status        TEXT NOT NULL,          -- OPEN | SETTLED | VOID
  invoice_no    INTEGER,
  opened_at     INTEGER NOT NULL,
  closed_at     INTEGER,
  total_paise   INTEGER NOT NULL DEFAULT 0,
  covers        INTEGER NOT NULL DEFAULT 0,
  doc           TEXT NOT NULL,          -- the whole order, as JSON
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_day ON orders (business_day);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS orders_table_open ON orders (table_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS orders_number ON orders (number);

-- Order and invoice numbers. Bumped inside the same transaction as the write
-- that uses them, so two terminals can never be handed the same bill number.
CREATE TABLE IF NOT EXISTS counters (
  name    TEXT PRIMARY KEY,
  value   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key     TEXT PRIMARY KEY,
  value   TEXT NOT NULL,                -- JSON
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
  id        TEXT PRIMARY KEY,
  category  TEXT NOT NULL,
  station   TEXT NOT NULL,
  sort      INTEGER NOT NULL DEFAULT 0,
  active    INTEGER NOT NULL DEFAULT 1,
  doc       TEXT NOT NULL,              -- the whole item, as JSON
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS menu_category ON menu_items (category);

-- The 86 board: taken off tonight, with who did it and why.
CREATE TABLE IF NOT EXISTS eighty_six (
  item_id   TEXT PRIMARY KEY REFERENCES menu_items (id) ON DELETE CASCADE,
  by_name   TEXT NOT NULL,
  note      TEXT NOT NULL DEFAULT '',
  at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id        TEXT PRIMARY KEY,
  at        INTEGER NOT NULL,
  day       TEXT NOT NULL,
  status    TEXT NOT NULL,
  doc       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Cancelled, not erased: a row that simply vanished could never be synced
  -- to the cloud copy, which would go on showing a booking nobody has.
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS reservations_day ON reservations (day);

-- Anything a manager might later be asked to explain.
CREATE TABLE IF NOT EXISTS audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  day       TEXT NOT NULL,
  kind      TEXT NOT NULL,
  actor     TEXT NOT NULL,
  message   TEXT NOT NULL,
  meta      TEXT
);
CREATE INDEX IF NOT EXISTS audit_day ON audit (day);
CREATE INDEX IF NOT EXISTS audit_at ON audit (at);

-- A trading session on the till: opening float, what was counted, the variance.
CREATE TABLE IF NOT EXISTS shifts (
  id            TEXT PRIMARY KEY,
  day           TEXT NOT NULL,
  opened_at     INTEGER NOT NULL,
  opened_by     TEXT NOT NULL,
  closed_at     INTEGER,
  closed_by     TEXT,
  float_paise   INTEGER NOT NULL DEFAULT 0,
  counted_paise INTEGER,
  doc           TEXT NOT NULL DEFAULT '{}',
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shifts_day ON shifts (day);
CREATE INDEX IF NOT EXISTS shifts_open ON shifts (closed_at) WHERE closed_at IS NULL;

-- Where the cloud copy has got to.
--
-- One row per table per direction, holding the `updated_at` of the newest row
-- already sent or received. The sync is a high-water mark and nothing more:
-- no change log to keep in step with the writes, and a till that has been off
-- for a week catches up by the same path as one that has been off for a
-- minute. See server/sync/ and docs/CLOUD-SYNC.md.
CREATE TABLE IF NOT EXISTS sync_state (
  name      TEXT PRIMARY KEY,           -- e.g. "push:orders", "pull:menu_items"
  watermark INTEGER NOT NULL DEFAULT 0,
  rows      INTEGER NOT NULL DEFAULT 0, -- how many have gone that way, ever
  at        INTEGER NOT NULL DEFAULT 0  -- when it last moved
);
