-- The Baruch Cafe — shared database setup.
-- Paste this whole block into Supabase → SQL Editor → Run.

create table if not exists tbc_sync (
  kind       text        not null,
  ref        text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (kind, ref)
);

-- Devices ask "what changed since?", so this is the index that matters.
create index if not exists tbc_sync_changed_idx on tbc_sync (updated_at);

-- The server stamps the time itself. A till with the wrong date must not be
-- able to hide its work from the others.
create or replace function tbc_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tbc_sync_touch on tbc_sync;
create trigger tbc_sync_touch before insert or update on tbc_sync
  for each row execute function tbc_touch();

-- Bill numbers. Postgres hands these out one at a time, so two tills billing
-- at the same moment cannot both produce bill 42.
create table if not exists tbc_counters (
  key   text   primary key,
  value bigint not null default 0
);

create or replace function tbc_next_order_no() returns bigint as $$
  insert into tbc_counters (key, value) values ('orderNo', 1)
  on conflict (key) do update set value = tbc_counters.value + 1
  returning value;
$$ language sql;

create or replace function tbc_peek_order_no() returns bigint as $$
  select coalesce((select value from tbc_counters where key = 'orderNo'), 0);
$$ language sql;

alter table tbc_sync     enable row level security;
alter table tbc_counters enable row level security;

-- Anyone holding the public key may read and write. That is deliberate: a
-- customer's phone has to place an order without an account. It is also why an
-- order is only ever a REQUEST that staff accept, why no payment happens
-- online, and why the counter prices every order from its own menu.
drop policy if exists "cafe access" on tbc_sync;
create policy "cafe access" on tbc_sync for all using (true) with check (true);

drop policy if exists "cafe counters" on tbc_counters;
create policy "cafe counters" on tbc_counters for all using (true) with check (true);

grant usage on schema public to anon;
grant all on tbc_sync, tbc_counters to anon;
grant execute on function tbc_next_order_no, tbc_peek_order_no to anon;

-- Supabase keeps a cached picture of the database for its API. It normally
-- refreshes itself, but not always straight away — and until it does, the app
-- is told the table does not exist. This nudges it.
notify pgrst, 'reload schema';
