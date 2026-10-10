-- ---------------------------------------------------------------------------
-- Saba — the cloud copy
-- ---------------------------------------------------------------------------
-- Run this once, in your Supabase project: SQL Editor → New query → paste →
-- Run. It is safe to run again; nothing here drops or empties a table.
--
-- What this is: a mirror of one restaurant's till. The till is still where
-- the restaurant trades. This copy exists so the owner can read the takings
-- from anywhere, so the data survives the till being stolen or catching
-- fire, and so a price or a member of staff can be changed without standing
-- at the machine.
--
-- Which way each table moves is decided on the till, in server/sync/tables.js:
--
--   up only    orders, audit, shifts, counters, reservations, eighty_six
--   both ways  menu_items, settings, users
--
-- Editing an order here will therefore be overwritten or simply ignored. The
-- till owns what happened; this copy owns nothing.
-- ---------------------------------------------------------------------------

-- Bills. `doc` is the whole order — lines, dockets, payments, the invoice —
-- as jsonb, so it can be queried rather than merely stored.
create table if not exists public.orders (
  id            text primary key,
  number        integer not null,
  code          text not null,
  business_day  date not null,
  table_id      text not null,
  status        text not null,
  invoice_no    integer,
  opened_at     bigint not null,
  closed_at     bigint,
  total_paise   bigint not null default 0,
  covers        integer not null default 0,
  doc           jsonb not null,
  -- The bill as it was added up, by the same function that printed it:
  -- gross, comps, discount, service charge, each tax component, the tip and
  -- the round-off. Re-deriving any of that in SQL would be a second
  -- implementation of the one piece of arithmetic an auditor checks.
  totals        jsonb,
  updated_at    bigint not null,
  synced_at     timestamptz not null default now()
);
create index if not exists orders_day on public.orders (business_day);
create index if not exists orders_status on public.orders (status);
create index if not exists orders_updated on public.orders (updated_at);

-- Every void, comp, discount, reopen and sign-in worth explaining later.
create table if not exists public.audit (
  id        bigint primary key,
  at        bigint not null,
  day       date not null,
  kind      text not null,
  actor     text not null,
  message   text not null,
  meta      jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists audit_day on public.audit (day);

-- A trading session: the float in, the drawer counted, the variance.
create table if not exists public.shifts (
  id            text primary key,
  day           date not null,
  opened_at     bigint not null,
  opened_by     text not null,
  closed_at     bigint,
  closed_by     text,
  float_paise   bigint not null default 0,
  counted_paise bigint,
  doc           jsonb not null default '{}'::jsonb,
  updated_at    bigint not null,
  synced_at     timestamptz not null default now()
);
create index if not exists shifts_day on public.shifts (day);

-- Order and invoice numbering. Small, and the reason a restore from this
-- copy can carry on trading rather than reissuing a bill number.
create table if not exists public.counters (
  name      text primary key,
  value     bigint not null,
  synced_at timestamptz not null default now()
);

-- Bookings. A cancelled one keeps its row with deleted_at set, so this copy
-- learns it is gone instead of going on showing a table nobody wants.
create table if not exists public.reservations (
  id         text primary key,
  at         bigint not null,
  day        date not null,
  status     text not null,
  doc        jsonb not null,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at  timestamptz not null default now()
);
create index if not exists reservations_day on public.reservations (day);

-- What is off the menu tonight. Mirrored whole on each sync.
create table if not exists public.eighty_six (
  item_id   text primary key,
  by_name   text not null,
  note      text not null default '',
  at        bigint not null,
  synced_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The three the till will read back
-- ---------------------------------------------------------------------------
-- Change a price, a dish's section, somebody's role or a tax rate here and
-- the till picks it up on its next pass. Later wins on `updated_at`, and the
-- till wins a tie, so set updated_at when you edit by hand — or better, use
-- the Setup screen on the till and let this copy follow.

create table if not exists public.menu_items (
  id         text primary key,
  category   text not null,
  station    text not null,
  sort       integer not null default 0,
  active     boolean not null default true,
  doc        jsonb not null,
  updated_at bigint not null,
  synced_at  timestamptz not null default now()
);

create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at bigint not null,
  synced_at  timestamptz not null default now()
);

-- Staff, without any PIN material. The till never sends a hash and never
-- accepts one, so this copy cannot be used to set somebody's PIN — a
-- compromised project must not become a way into the restaurant's till.
create table if not exists public.users (
  id         text primary key,
  name       text not null,
  initials   text not null,
  role       text not null,
  active     boolean not null default true,
  created_at bigint not null,
  updated_at bigint not null,
  synced_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Who may read this
-- ---------------------------------------------------------------------------
-- Row-level security on, with no policy granting anyone anything. That means:
--
--   anon / authenticated   nothing at all, even with the public anon key
--   service_role           everything — it bypasses RLS by design, and it is
--                          the key the till uses
--   you, in the dashboard  everything, through your own Supabase login
--
-- So the data is reachable from anywhere you can log in to Supabase, and from
-- nowhere else. If you later build something that reads this with the anon
-- key, add a policy then, deliberately, for exactly the rows it needs.

do $$
declare t text;
begin
  foreach t in array array['orders', 'audit', 'shifts', 'counters',
                           'reservations', 'eighty_six', 'menu_items',
                           'settings', 'users']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Stamp every write with the time it arrived, so "when did this till last
-- reach us?" is answerable without trusting the till's own clock.
create or replace function public.touch_synced_at() returns trigger as $$
begin
  new.synced_at = now();
  return new;
end $$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['orders', 'audit', 'shifts', 'counters',
                           'reservations', 'eighty_six', 'menu_items',
                           'settings', 'users']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_synced_at', t);
    execute format(
      'create trigger %I before insert or update on public.%I'
      ' for each row execute function public.touch_synced_at()',
      t || '_synced_at', t);
  end loop;
end $$;
