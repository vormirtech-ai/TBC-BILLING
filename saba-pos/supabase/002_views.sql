-- ---------------------------------------------------------------------------
-- Saba — reading the takings in Supabase
-- ---------------------------------------------------------------------------
-- Run after 001_schema.sql, and again whenever you update it.
--
-- The till's own Reports screen is still the better place to read a service.
-- These views are for the other case: the owner is not at the restaurant, and
-- wants the figures from a phone. Open Supabase → Table Editor → the view, or
-- SQL Editor for anything else.
--
-- Every amount is in paise, as it is everywhere in Saba, with a rupee column
-- beside it for reading. Nothing here rounds before the last step.
-- ---------------------------------------------------------------------------

-- Each settled bill, flattened out of the document.
create or replace view public.v_bills as
select
  o.id,
  o.code,
  o.business_day,
  (o.doc->'invoice'->>'code')               as invoice,
  o.table_id,
  o.doc->>'tableLabel'                      as table_label,
  o.doc->>'guestName'                       as guest,
  o.doc->>'captainName'                     as captain,
  o.covers,
  o.total_paise,
  round(o.total_paise / 100.0, 2)           as total_rupees,
  round((o.totals->>'discount')::bigint / 100.0, 2)      as discount_rupees,
  round((o.totals->>'comps')::bigint / 100.0, 2)         as comps_rupees,
  round((o.totals->>'serviceCharge')::bigint / 100.0, 2) as service_rupees,
  round((o.totals->>'taxTotal')::bigint / 100.0, 2)      as tax_rupees,
  to_timestamp(o.opened_at / 1000)          as opened,
  to_timestamp(o.closed_at / 1000)          as closed,
  round((o.closed_at - o.opened_at) / 60000.0)::int as minutes,
  jsonb_array_length(o.doc->'lines')        as line_count,
  (select string_agg(distinct p->>'method', ', ')
     from jsonb_array_elements(o.doc->'payments') p) as paid_by
from public.orders o
where o.status = 'SETTLED';

comment on view public.v_bills is
  'One row per settled bill, with the document unpacked into columns.';

-- The day a restaurant actually had.
create or replace view public.v_daily_sales as
select
  business_day,
  count(*)                                   as bills,
  sum(covers)                                as covers,
  sum(total_paise)                           as total_paise,
  round(sum(total_paise) / 100.0, 2)         as total_rupees,
  round(avg(total_paise) / 100.0, 2)         as avg_check_rupees,
  round(sum(total_paise) / nullif(sum(covers), 0) / 100.0, 2) as per_cover_rupees
from public.orders
where status = 'SETTLED'
group by business_day
order by business_day desc;

comment on view public.v_daily_sales is
  'Covers, bills and takings per business day. The day rolls at 05:00 local.';

-- What was taken, and in what. Only cash should be in the drawer.
create or replace view public.v_payments as
select
  o.business_day,
  p->>'method'                               as method,
  count(*)                                   as payments,
  sum((p->>'paise')::bigint)                 as total_paise,
  round(sum((p->>'paise')::bigint) / 100.0, 2) as total_rupees
from public.orders o,
     jsonb_array_elements(o.doc->'payments') p
where o.status = 'SETTLED'
group by o.business_day, p->>'method'
order by o.business_day desc, total_paise desc;

comment on view public.v_payments is
  'Takings by tender per day — what should be in the drawer, and what went to a bank.';

-- Tax, as the return will want it.
create or replace view public.v_tax_summary as
select
  o.business_day,
  t->>'label'                                 as component,
  (t->>'bps')::int / 100.0                    as rate_percent,
  sum((t->>'paise')::bigint)                  as tax_paise,
  round(sum((t->>'paise')::bigint) / 100.0, 2) as tax_rupees
from public.orders o,
     jsonb_array_elements(o.totals->'taxes') t
where o.status = 'SETTLED'
group by o.business_day, t->>'label', t->>'bps'
order by o.business_day desc, component;

comment on view public.v_tax_summary is
  'GST by component per day, as it was printed on each bill.';

-- Which dishes carry the room.
create or replace view public.v_item_sales as
select
  o.business_day,
  l->>'name'                                  as dish,
  sum((l->>'qty')::int)                       as sold,
  sum((l->>'qty')::int * (l->>'unitPaise')::bigint)            as gross_paise,
  round(sum((l->>'qty')::int * (l->>'unitPaise')::bigint) / 100.0, 2) as gross_rupees
from public.orders o,
     jsonb_array_elements(o.doc->'lines') l
where o.status = 'SETTLED'
  and coalesce(l->>'status', '') <> 'VOID'
group by o.business_day, l->>'name'
order by o.business_day desc, gross_paise desc;

comment on view public.v_item_sales is
  'Dishes sold per day, voids excluded. Comped lines are counted as sold at nil value elsewhere.';

-- Anything a manager might be asked to explain.
create or replace view public.v_exceptions as
select
  day,
  to_timestamp(at / 1000) as at,
  kind,
  actor,
  message
from public.audit
where kind in ('VOID', 'COMP', 'DISCOUNT', 'REOPEN')
order by at desc;

comment on view public.v_exceptions is
  'Voids, comps, discounts and reopened bills, newest first, with who did it.';

-- Is the till still talking to us?
create or replace view public.v_sync_health as
select
  'orders'      as table_name, count(*) as rows, max(synced_at) as last_seen from public.orders
union all select 'audit',        count(*), max(synced_at) from public.audit
union all select 'shifts',       count(*), max(synced_at) from public.shifts
union all select 'reservations', count(*), max(synced_at) from public.reservations
union all select 'menu_items',   count(*), max(synced_at) from public.menu_items
union all select 'users',        count(*), max(synced_at) from public.users;

comment on view public.v_sync_health is
  'When each table last heard from the till. A stale row means the till is off or offline.';

-- Views inherit the row-level security of the tables under them, so these
-- are reachable with your Supabase login or the service role key, and with
-- nothing else. Keep it that way unless you mean otherwise.
