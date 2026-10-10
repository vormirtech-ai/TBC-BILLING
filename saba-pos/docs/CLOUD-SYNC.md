# The cloud copy

Optional. Saba is local-first: the restaurant trades on its own computer, on
its own network, and this changes none of that. What it adds is an off-site
copy of the trading in a Supabase project, so that

- the data survives the till being stolen, flooded or dropped;
- an owner can read the takings from anywhere they can log in;
- a price, a dish or a member of staff can be changed without standing at
  the machine.

**Leave it unconfigured and nothing happens.** No connection is attempted, no
background job runs, and the restaurant works exactly as it did.

---

## What moves, and which way

This is the whole safety argument, so it is worth reading once.

| | Direction | Why |
|---|---|---|
| Bills, dockets, payments | **up only** | The till is the only thing that creates them. They cannot conflict, and nothing in the cloud can alter what a guest was charged. |
| Audit trail | **up only** | A record of who voided what. Append-only by nature. |
| Shifts, counters | **up only** | The drawer counts and the invoice numbering, so a restore can carry on trading. |
| Reservations | **up only** | Taken on the till. A cancelled booking keeps its row with `deleted_at` set, so the cloud learns it is gone. |
| 86 board | **up only** | Mirrored whole each pass, so a dish put back on stops being 86 up there too. |
| **Menu and prices** | **both ways** | So an owner can change a price from anywhere. |
| **Charges, tax, floor plan** | **both ways** | Same. |
| **Staff** | **both ways** | Rename, change a role, switch somebody off. |

**PINs never leave the building.** `pin_hash` and `pin_salt` are on a refusal
list in `server/sync/tables.js`; the cloud has no column for them and the
till would not accept one back. A manager can be demoted from the cloud;
their PIN can only be changed in the restaurant. That is deliberate — a
compromised Supabase project must not become a way into the till.

### When two people change the same thing

Only configuration can be changed in two places. The later edit wins, by
`updated_at`, and the till wins a tie. A bill cannot conflict, because
nothing but the till ever writes one.

---

## Setting it up

### 1. Create the project

1. Sign in at [supabase.com](https://supabase.com) and create a project. The
   free tier is enough for a single restaurant: a year of trading is a few
   tens of megabytes.
2. Choose the region closest to the restaurant.
3. Save the database password somewhere safe. You will not need it for this,
   but you will need it one day.

### 2. Create the tables

In the Supabase dashboard: **SQL Editor → New query**. Paste the whole of
`supabase/001_schema.sql`, press **Run**. Then do the same with
`supabase/002_views.sql`.

Both are safe to run again — they create nothing twice and drop nothing — so
re-run them after an upgrade that changes them.

### 3. Get the keys

**Project Settings → API**. You need two things:

- the **Project URL**, like `https://abcdefgh.supabase.co`
- the **`service_role`** key, under Project API keys

> **The service role key bypasses all access control.** That is why the till
> uses it, and why it must live only in the till's environment: never in a
> browser, never committed to a repository, never pasted into a chat or an
> email. If it ever leaks, rotate it in Supabase and update the till.
>
> The `anon` key will not work. The till would be refused, which is the
> intended behaviour.

### 4. Tell the till

**On a systemd install**, put them in `/etc/saba.env`:

```sh
SABA_SUPABASE_URL=https://abcdefgh.supabase.co
SABA_SUPABASE_KEY=eyJhbGciOi...
SABA_SYNC_MINUTES=10
```

```sh
sudo chmod 600 /etc/saba.env
sudo chown root:root /etc/saba.env
sudo systemctl restart saba
```

**In Docker**, put the same three lines in `.env` beside `docker-compose.yml`
and `docker compose up -d`.

### 5. Check it

```sh
journalctl -u saba | grep -i "cloud sync"
```

You want `cloud sync is on`. Then open **Setup → Cloud backup** on the till:
it shows the project, when it last synced, and how much is waiting. Press
**Sync now** and the first pass goes up — a month of history takes a few
seconds.

In Supabase, **Table Editor → orders** should now have rows.

---

## Reading the takings from anywhere

Log in to Supabase and open **Table Editor**. The views are the useful part:

| View | What it shows |
|---|---|
| `v_daily_sales` | Covers, bills and takings per business day |
| `v_bills` | Each settled bill, with guest, captain, covers and how it was paid |
| `v_payments` | Takings by tender per day — what should have been in the drawer |
| `v_tax_summary` | GST by component per day, as printed on each bill |
| `v_item_sales` | Dishes sold per day |
| `v_exceptions` | Every void, comp, discount and reopened bill, with who did it |
| `v_sync_health` | When each table last heard from the till |

Anything else is a SQL query away, and the order document is `jsonb`, so the
lines, dockets and payments inside it are queryable too:

```sql
-- The ten biggest bills this month
select business_day, table_label, guest, total_rupees
from v_bills
where business_day >= date_trunc('month', current_date)
order by total_rupees desc
limit 10;
```

### Who can see it

Row-level security is on and forced for every table, with no policy granting
anything. In practice:

- **your Supabase login** — everything;
- **the till**, with the service role key — everything;
- **anyone with the public anon key** — nothing at all.

If you later build something that reads this with the anon key, add a policy
then, for exactly the rows it needs, and no more.

### Changing something from the cloud

Edit a row in `menu_items`, `settings` or `users` and **set `updated_at` to
now in milliseconds** (`select (extract(epoch from now()) * 1000)::bigint`).
The till compares that against its own copy; a row with an old timestamp is
ignored as stale.

Doing it from the till's own Setup screen is better in every way — it
validates what you type, and the cloud follows within minutes.

---

## When it goes wrong

The sync can fail all day and the restaurant will not notice. That is the
design: it never blocks a bill, never holds up a docket, and never shows a
guest an error. Failures are recorded and retried.

| What Setup → Cloud backup says | What it means |
|---|---|
| `The cloud could not be reached` | No internet, or Supabase is down. Normal; it catches up by itself. |
| `Supabase refused the key` | Wrong key, or the anon key instead of the service role key. |
| `Supabase has no such table` | `001_schema.sql` has not been run, or only partly. |
| `Waiting to go up: 400 orders` | It has been offline a while. Press **Sync now**, or leave it. |
| Last sync `never`, no error | It has not run yet. The first pass is a minute after start-up. |

```sh
journalctl -u saba | grep -i sync      # what it has been doing
```

Nothing is ever lost by a failed sync: the till keeps its own high-water
mark and resends from there. The worst case is that a batch goes twice, and
an upsert makes that a no-op.

---

## Restoring from the cloud

The cloud copy is a readable mirror, not a backup file. **To restore a till,
use a real backup** — `tools/restore.mjs` and a file from `data/backups/`.
That is a complete SQLite database, and it is the supported path.

The cloud copy is what you reach for when the backups are gone too: every
bill, every line and every payment is in `orders.doc`, in an open format,
and `counters` carries the invoice numbering so a rebuilt till does not
reissue a bill number. Rebuilding from it is a job, not a button.

---

## Costs and limits

- A single restaurant writing ~900 bills a month is a few megabytes a year.
  Supabase's free tier is 500 MB.
- The sync sends only what changed, so a normal pass is a few kilobytes.
- Free Supabase projects **pause after a week of inactivity**. A till syncing
  every ten minutes keeps it awake; one switched off for a holiday may need
  the project resumed from the dashboard.

## Turning it off

Remove the two settings and restart. The till keeps everything; the cloud
keeps what it already had. Nothing else changes.
