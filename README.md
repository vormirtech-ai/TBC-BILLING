# The Baruch Cafe — Billing & POS

A complete point-of-sale, billing and cafe-management system for The Baruch
Cafe. It runs entirely in the browser, needs no server, and deploys to GitHub
Pages as-is.

Billing and bill history, table QR ordering, stock control with recipes, and
staff attendance with an editable rota — plus a per-day Excel export that an
accountant can open without asking any questions.

---

## Contents

1. [What it does](#what-it-does)
2. [Technology](#technology)
3. [Running it locally](#running-it-locally)
4. [Build step](#build-step)
5. [Deploying to GitHub Pages](#deploying-to-github-pages)
6. [Sign-in accounts](#sign-in-accounts)
7. [The menu](#the-menu)
8. [Tables and QR ordering](#tables-and-qr-ordering)
9. [Live QR ordering (optional)](#live-qr-ordering-optional)
10. [Stock](#stock)
11. [Staff, attendance and the rota](#staff-attendance-and-the-rota)
12. [Where the data lives](#where-the-data-lives)
13. [Excel export](#excel-export)
14. [Backup and restore](#backup-and-restore)
15. [Limitations of static hosting](#limitations-of-static-hosting)
16. [Moving to a real backend later](#moving-to-a-real-backend-later)
17. [Project layout](#project-layout)
18. [Automated tests](#automated-tests)
19. [Testing checklist](#testing-checklist)

---

## What it does

**For the cashier**

- Tap-to-add menu grid, 48 items across six categories, with instant search
  (`/` focuses the search box, `Enter` adds the first match).
- Tapping the same drink again bumps the quantity instead of adding a second row.
- Live subtotal, tax, discount and total, all recalculated as items change.
- Payment in Cash, UPI or Card. Cash shows quick-tender buttons and calculates
  change as you type.
- Printable bill, sized for a 76 mm thermal roll or ordinary paper.
- An unpaid order survives a refresh, a crash or a closed lid.
- Seat an order at a table, and take orders that customers sent in from a table
  QR code — one tap turns a request into a bill.

**For the customer**

- Scan the QR code on the table, see the menu on their own phone, and send an
  order to the counter. No app to install and no sign-in.
- Nothing is charged on the phone. An order is a request; staff confirm it and
  payment happens as usual.

**For the admin**

- Everything above, plus:
- Dashboard: sales, bill count, average bill, payment split, top sellers,
  category split and a 14-day trading trend.
- Bill history with search and filters by date, cashier, payment method and status.
- Void a bill with a reason. The record stays in history and in exports, flagged
  and removed from totals, so the audit trail is never broken.
- Menu management: add, edit, reprice, reorder availability, attach photos.
- Settings: cafe details, tax, discounts, rounding, bill numbering, business-day
  numbering, user accounts.
- Tables: add them in bulk, and each gets its own QR code automatically. Print a
  sheet of cards to cut up and stand on the tables.
- Stock: what is on the shelf, what needs ordering, what it is worth, and a
  movement record explaining every change. Recipes tie a menu item to its
  ingredients so a sale takes them off the shelf by itself.
- Staff: attendance with clock-in and clock-out, an editable week rota, and
  hours totalled for payroll.
- Excel export per business day, per date range, everything, plus stock and
  attendance.
- Backup and restore as a JSON file.

---

## Technology

| Layer | Choice | Why |
| --- | --- | --- |
| UI | Plain ES modules + CSS | No build step, no framework runtime, nothing to break at the counter |
| Storage | IndexedDB | Structured, transactional, survives refreshes and offline use |
| Excel | Hand-written OOXML writer (`src/lib/xlsx.js`) | No CDN dependency; exports work with no internet |
| Routing | Hash routes (`#/pos`) | Works at any GitHub Pages base path with zero configuration |
| Money | Integer paise, everywhere | Floating-point rupees drift; a till that drifts is a till nobody trusts |

There are **no runtime dependencies** — no npm install, no bundler, no
`node_modules`. The two web fonts load from Google Fonts and fall back to system
faces if the cafe's internet is down.

---

## Running it locally

**Double-click `start.bat` (Windows) or `start.command` (Mac).** That is the
whole procedure. A small console window opens and your browser lands on
<http://localhost:8000>. Leave that window open while the till is in use;
closing it stops the app.

### Why you cannot just double-click `index.html`

Opening the file directly gives you a blank white page. This is not a fault in
the app — it is a browser security rule, and it bites twice:

1. A page loaded from `file://` has **no origin**, and browsers refuse to load
   JavaScript modules into a page with no origin. None of the app's code runs.
2. **IndexedDB is blocked on `file://` in Chrome and Edge.** Even if the screen
   drew, not one sale could be saved.

Serving from `localhost` fixes both, and it is also what makes the Web Crypto
API available for password hashing (browsers expose it only on `https://` and
`localhost`). If someone does open the file directly, the page now detects it
and shows these instructions instead of a blank screen.

### If you prefer to start it by hand

```bash
python3 -m http.server 8000     # Python
node serve.js 8000              # Node — serve.js is included, no install
```

`serve.js` is a ~60-line static server built on Node's standard library, added
so the launcher works on a machine that has Node but not Python. It serves only
this folder and nothing above it.

If port 8000 is busy, pass another number: `node serve.js 8080`.

---

## Build step

There isn't one. What you see in the repository is what runs in the browser.

---

## Deploying to GitHub Pages

**Option A — automatic (recommended).** The included workflow deploys on every
push to `main`.

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages → Build and deployment**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main`. The workflow at `.github/workflows/deploy.yml` publishes the
   site and prints the URL in the run summary.

**Option B — no workflow.** Settings → Pages → Source → *Deploy from a branch*,
pick `main` and the `/ (root)` folder.

Two details that are already handled for you:

- **Base path.** Every asset is referenced relatively (`src/main.js`,
  `assets/logo.jpg`), and routing is hash-based, so the app works unchanged at
  `https://<user>.github.io/<repo>/` without any base-URL configuration.
- **`.nojekyll`.** Present in the repository root so GitHub serves every file
  as-is instead of running Jekyll over it.

---

## Sign-in accounts

Accounts are seeded into the browser the first time the app runs on a device.

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `baruch@2026` | Admin — full access |
| `cashier` | `cafe@1234` | Cashier — counter and payments only |

**Change both before the first real shift**: sign in as admin →
**Settings → Users → Password**. You can also add more cashiers there, disable an
account without deleting it, and give another person admin rights.

To change the seeded defaults before deploying, edit `DEFAULT_USERS` in
[`src/config/app.config.js`](src/config/app.config.js) — that file is the single
place credentials appear.

### About security, honestly

Passwords are stored as salted SHA-256 hashes rather than plain text, and role
checks run in the storage layer — a cashier calling the menu-write function
directly from the console gets refused, not just a hidden button. That is real,
and it is enough to keep a shared counter machine tidy.

It is **not** server-grade authentication. Everything runs on the client, so
anyone with the device, patience and DevTools can reach the underlying data.
This design is right for a single-shop till; it is not right for handling
card data or anything you would be legally liable for losing.

---

## The menu

All 48 items — names, prices and descriptions — come from the cafe's printed menu
and live in [`src/data/menu.seed.js`](src/data/menu.seed.js).

| Category | Items |
| --- | --- |
| Hot | 8 |
| Iced | 9 |
| Frappe's | 7 |
| Non-Coffee Based | 9 |
| Cold Brews | 6 |
| TBC Specials | 9 |

The seed file is only read the first time the app opens on a device. After that,
the live menu lives in the browser database and is edited from **Menu** in the
app. Editing the seed file will not change a device that has already been used —
to force it, use **Settings → Reset menu to the menu file** (this discards menu
edits; it does not touch past bills).

**Price changes never rewrite history.** When an item is added to an order, its
price, name, category and tax rate are copied onto the order line. Raising the
price of a Latte tomorrow leaves every Latte sold today reading exactly what the
customer paid.

---

## Tables and QR ordering

### Setting it up

1. Open **Tables** and use **Add several** — "8 tables, starting at 1" is one
   dialog, not eight.
2. Each table gets its own **QR code** immediately. Nothing to configure: the
   code points at wherever the app is being used, so it is correct on GitHub
   Pages, on a custom domain, or on a laptop, without being told.
3. Press **Print all QR cards**, cut the sheet up, and stand a card on each
   table.
4. After changing prices, open **Menu → Publish for QR ordering** (see below).

The QR code carries the site address, a random token identifying the table, and
the table's name. Nothing about the cafe's data is inside it. If a card walks
off or a code leaks, **New code** retires the old card instantly.

### What the customer sees

Scanning opens the menu on their phone — no app, no sign-in. They choose items,
review the order, and send it. The screen is honest about what just happened:
nothing is charged on the phone, and a member of staff confirms the order.

### How an order reaches the counter

This is the one place where "a static site with no server" has real
consequences, so it is worth being plain about it.

GitHub Pages serves files. It has no database. A customer's phone and the
counter each keep their own storage, in their own browser, and nothing travels
between them by itself. So the app uses whichever of three routes is available:

| Route | When it is used | What happens |
| --- | --- | --- |
| **Same browser** | The customer menu is open in another tab on the counter device | The order appears in the queue instantly |
| **Handoff code** | The default, with no setup at all | The customer's phone shows a QR code and four characters; the counter scans or types it |
| **Shared backend** | You filled in the live-ordering settings | The order arrives at the counter on its own, within seconds |

**The handoff code is not a workaround, it is a working method.** The customer's
phone shows a code; on **Orders**, press **Scan a customer's code**, hold it up
to the camera — or type the four characters — and the order lands on the till,
priced and ready for payment. It needs no network at all.

If you want orders to arrive by themselves, set up the shared backend below. It
takes about five minutes and is free.

### Publishing the menu

A phone that has never opened your site has no way to read the counter's
database, so customers read a **published copy** of the menu.

- With live ordering on: **Menu → Publish for QR ordering → Publish live**. Done.
- Without it: the same dialog downloads `menu.published.json`. Put that file in
  the site's `data/` folder, commit, and deploy. A copy is already included, so
  QR ordering works from the moment you host the site.

The dialog tells you whether the published menu still matches your working menu,
so you are never guessing. **Prices on a phone are only ever an estimate — the
counter prices every order from its own menu when it is billed.**

---

## Live QR ordering (optional)

Skip this section entirely if the handoff code suits you. Everything else in the
app works without it.

Turning this on lets an order sent from any phone, anywhere, land on the counter
by itself. It uses [Supabase](https://supabase.com), whose free tier is far more
than a cafe needs.

**1. Create the project.** Sign up, create a project, and wait for it to finish
setting up.

**2. Create one table.** Open the SQL editor and run this:

```sql
create table if not exists tbc_sync (
  id         bigint generated always as identity primary key,
  kind       text        not null,
  ref        text        not null,
  status     text,
  payload    jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per order, and one for the published menu.
create unique index if not exists tbc_sync_ref_idx on tbc_sync (ref);
create index if not exists tbc_sync_kind_idx on tbc_sync (kind, updated_at);

alter table tbc_sync enable row level security;

-- A customer's phone must be able to send an order and read its own menu, and
-- the counter must be able to read the queue and update what it has dealt with.
create policy "cafe ordering" on tbc_sync
  for all using (true) with check (true);
```

**3. Point the app at it.** In Supabase, **Project Settings → API** gives you the
**Project URL** and the **anon public** key. In the app, open **Settings → Live
ordering**, paste both in, press **Test connection**, then **Save**. Reload the
page and the counter starts collecting orders.

**4. Publish the menu** from **Menu → Publish for QR ordering → Publish live**.

### What is and is not sent

Sent: order lines, table names, and the published menu.

Never sent: your takings, your bills, your stock, your staff records, your
passwords. Those stay on the till.

### Read this before turning it on

The anon key is public by design — it sits in the browser of every customer who
scans a code. Treat that table as readable and writable by anyone who has the
key. That is exactly why **an order is only ever a request that staff accept**,
why no payment is taken online, and why the counter prices every order itself.
The worst a stranger can do is put a fake order in the queue for someone to
decline.

Use the **anon public** key. Never the service role key.

---

## Stock

Stock answers three questions, and the screen is arranged around them.

**What do I need to order?** Give each item a reorder level and the Stock screen
highlights anything at or below it, with a count on the navigation bar so you
notice without looking.

**Where did it go?** Nothing is ever silently overwritten. A level moves because
something happened — a delivery, a sale, a dropped jug, a recount — and each one
writes a movement record. **History** on any item shows the lot.

**What does a drink cost me?** A **recipe** links a menu item to what one portion
uses: 18 g of beans, 150 ml of milk. Every sale then takes that off the shelf by
itself, inside the same operation that saves the bill — so a bill can never be
saved while the ingredients it used stay on the shelf. Voiding the bill puts them
back. The recipe list also shows cost and margin per item.

Items with no recipe still sell perfectly well; they just do not move stock.

Two settings, under **Settings → Stock**:

- *Take ingredients off the shelf when something sells* — the whole feature,
  on or off.
- *Refuse a sale when an ingredient has run out* — **off by default, and that is
  deliberate.** A customer is standing at the counter with money in their hand.
  The usual answer is to warn the cashier and let the sale through, then let
  someone sort the shelf out afterwards.

Quantities are stored as whole thousandths of a unit, never as decimals, for the
same reason money is stored in whole paise: deduct 18 g four hundred times a week
in floating point and the figure quietly stops matching the shelf.

---

## Staff, attendance and the rota

Three separate things, kept separate on purpose:

- **Staff** — people who work at the cafe. Not the same as a till login: the
  kitchen porter has no reason to sign in, and a manager who leaves should lose
  their login without erasing the hours they worked last month.
- **The rota** — what someone is *meant* to work. A week grid, because that is
  how a rota is drawn on the wall. Click any cell to add a shift, click a shift
  to edit or delete it, and **Copy a day** builds next week from this one.
- **Attendance** — what actually happened. Clock in and clock out from the
  Today panel, and correct it afterwards, because the one certainty about
  clocking out is that somebody will forget.

**Hours this week** totals worked hours (clock times, less unpaid breaks) beside
rostered hours, and works out wages from each person's hourly rate. **Export
hours** produces the spreadsheet a payroll run starts from.

Shifts that cross midnight are handled properly everywhere — a 22:00–06:00 shift
is eight hours, not a negative day.

---

## Where the data lives

Everything is stored in **IndexedDB in the browser on the device running the
app**, in fourteen stores: menu items, transactions, business days, settings,
counters, users, inventory, stock movements, recipes, staff, shifts,
attendance, tables and online orders.

**Upgrading from version 1.** A till already holding sales keeps every one of
them. The database upgrade only creates the stores that are missing, and menu
items are quietly given the stable code that QR ordering needs. Nothing to do
but deploy.

**Business days.** A day record is created by the first sale taken on a date, so
Day 1, Day 2, Day 3 follow *trading* days — a closed Monday does not consume a
number. Set the starting number and, if the cafe trades past midnight, a
rollover hour (e.g. `4` makes a 1 a.m. sale belong to the previous day) in
**Settings → Business days**.

**Bill numbers.** `ORD-000001` upward, allocated from a counter in the database.
Number allocation, the sale record, the day's running totals *and the stock the
sale consumed* are written in a single IndexedDB transaction that the app waits
on until it commits. Either a bill gets a unique number, is durably saved and
its ingredients leave the shelf, or nothing happened at all — a refresh mid-save
cannot produce a half-written bill, a skipped number, or stock that went missing
without a sale to explain it.

---

## Excel export

**Admin → Bills → Export to Excel**, or **Export today** on the dashboard.

- One business day → `Cafe_Billing_Day_01.xlsx` (the number is the business-day
  number, so Day 7 exports as `Cafe_Billing_Day_07.xlsx`).
- A date range → `Cafe_Billing_2026-08-01_to_2026-08-31.xlsx`.
- Everything → `Cafe_Billing_All_<last date>.xlsx`.

Each workbook has two sheets.

**Transactions** — one row per item, with frozen headers, filters and real Excel
data types (dates are dates, money is currency-formatted, quantities are
numbers). Columns: transaction id, bill number, business day, date, time,
cashier, payment method, status, item name, category, quantity, unit price, item
total, item discount, item tax, line total, then the order-level subtotal,
discount, tax, round-off and grand total, customer and note.

> **How to sum a column.** Order-level totals (subtotal, discount, tax, grand
> total) appear **once per order, on its first item row**, and are blank on the
> rest. That keeps every item tied to its bill while letting you put a plain
> `=SUM()` under the Grand Total column without counting an order twice.

**Daily Summary** — total sales, bills completed and voided, items sold, average
bill, discounts given, tax collected, a payment-method split, the top 15 sellers
and a per-cashier breakdown.

---

### Stock and attendance exports

Two more workbooks, from the screens they belong to:

- **Stock → Export to Excel** — current levels, reorder flags and value on one
  sheet; every movement behind them on a second. A stocktake usually needs both
  open at once.
- **Staff → Export hours** — the week shown on screen, day by day on one sheet
  and totalled per person on the other, with hours as decimals because that is
  what payroll multiplies by.

---

## Backup and restore

**Settings → Backup and restore.**

- **Export backup** downloads `Cafe_POS_Backup_<date>.json` containing the menu,
  every bill, business days, settings, user accounts, stock and its movements,
  recipes, staff, the rota, attendance, tables and QR orders — everything.
- **Restore from backup** validates the file first, downloads a safety copy of
  what is currently on the device, and only then replaces anything. A damaged or
  foreign file is refused rather than half-imported.
- Backups from version 1 still restore. The sections they do not have simply
  come back empty.
- Table QR tokens survive a restore, so **printed cards keep working** on the
  restored device.

**Take a backup at the end of each trading day.** Browser storage is durable but
not indestructible: clearing site data, a browser reset, or an aggressive
"clean-up" tool will take the sales history with it. The app asks the browser
for persistent storage on startup, which helps, but a file in your Drive helps more.

---

## Limitations of static hosting

**This deployment uses local browser storage. Data created on one device will not
automatically appear on another device.**

What that means day to day:

- The counter iPad and the manager's laptop each keep their own separate set of
  bills. Bill numbering is per device, so two devices billing at once will both
  produce an `ORD-000042`.
- The same applies to stock, staff and tables: they live on the till that
  recorded them.
- **QR orders are the exception**, and only if you set up live ordering. Without
  it, a customer's order reaches the counter as a code staff scan — which works
  between any two devices, with no network at all. See
  [Tables and QR ordering](#tables-and-qr-ordering).
- **Run billing on one device.** To review sales elsewhere, export a backup from
  the till and restore it on the other device.
- Clearing browser data for the site erases the sales history on that device.
- Private/incognito windows discard everything on close — the app will warn you
  if it cannot open storage at all.
- Signing out ends the session; closing the tab does too, by design, so an
  unattended till does not stay open.

---

## Moving to a real backend later

The code is layered so this is a contained change rather than a rewrite:

```
views  →  services  →  repositories  →  db/database.js  →  IndexedDB
```

Views never touch storage. Every read and write goes through a repository
(`src/repositories/*.repo.js`), and only `src/db/database.js` knows IndexedDB
exists.

To move to Supabase, Firebase or your own API:

1. Reimplement the repository modules against the network, keeping the same
   exported function names and return shapes.
2. Delete `src/db/database.js` (or keep it as an offline cache).
3. Leave `src/views/`, `src/services/` and `src/ui/` alone.

Two things carry over unchanged and are worth keeping: money stays in integer
paise end to end, and saved transactions stay snapshots rather than references to
current menu rows.

---

## Project layout

```
start.bat                   double-click to run on Windows        ← start here
start.command               double-click to run on macOS          ← start here
serve.js                    tiny static server used by the above
index.html                  markup shell
manifest.webmanifest        installable-app metadata
.nojekyll                   tells GitHub Pages to serve files as-is
styles/app.css              design tokens, layout, components, print styles
assets/                     logo and favicon
data/menu.published.json    the menu customers see when they scan a table code

src/
  main.js                   boot, routes, role guard
  config/app.config.js      credentials, defaults, payment methods  ← edit me
  data/menu.seed.js         the printed menu, 48 items              ← edit me
  core/
    money.js                integer-paise maths and formatting
    quantity.js             integer-thousandths maths for stock
    utils.js                DOM helpers, dates, business-day keys, files
    session.js              who is signed in; requireAdmin guard
    router.js               hash router
  db/database.js            the only file that speaks IndexedDB
  lib/
    xlsx.js                 ZIP + OOXML writer
    qrcode.js               QR encoder — no dependencies, works offline
  repositories/             menu, transactions, business days, settings, users,
                            inventory, staff, tables, online orders
  services/                 pricing, cart, orders, auth, export, backup, reports,
                            order channel, cloud sync, published menu
  ui/                       shell, modals, toasts, receipt
  views/                    login, pos, dashboard, history, menu, settings,
                            tables, orders, inventory, staff, customer

tests/
  run.mjs                   runs everything below
  pricing.test.mjs          66 assertions on the money maths
  cafe.test.mjs             78 on quantities, shifts, handoff codes, menu codes
  qrcode.test.mjs           138 round-tripping QR codes through a decoder
```

---

## Automated tests

No dependencies, no install, no test runner to configure:

```bash
node tests/run.mjs
```

282 assertions across three files.

**`pricing.test.mjs` — 66.** The one part of this app where a bug costs real
money: integer-paise arithmetic, discount distribution (the parts always sum to
the whole, exactly), inclusive vs exclusive tax, per-item tax overrides,
discount caps, round-off, and the rule that a menu price change must never alter
a bill that was already printed.

**`cafe.test.mjs` — 78.** Stock quantities (including four hundred deductions
that must not drift), shift and attendance maths (including shifts that cross
midnight), the handoff code that carries an order between two devices — proving
a mistyped one is refused and that no price ever travels in it — and the stable
menu codes two devices use to agree on what an item is.

**`qrcode.test.mjs` — 138.** The QR encoder, round-tripped through an
independent decoder written into the test file: every correction level, every
mask, multibyte text, and the structural rules a scanner depends on. While it
was being written the encoder was also checked module-for-module against an
independent implementation across versions 1 to 33, and its output was decoded
back out of an actual screenshot of a rendered table card.

## Testing checklist

Worth walking through after any change:

1. **Login** — wrong password refused; admin and cashier both get in.
2. **Role separation** — cashier sees no Menu/Settings/Dashboard links, and
   typing `#/settings` bounces back to the counter.
3. **Add items** — tapping the same drink twice merges to quantity 2.
4. **Quantities** — `+`, `−`, typing a number, and removing a line all update the total.
5. **Discount** — percentage and flat both apply; the parts still add up.
6. **Payment** — cash change is right; UPI and Card skip the cash box.
7. **Bill numbers** — first sale is `ORD-000001`, second is `ORD-000002`.
8. **Price change** — reprice an item, then reopen an earlier bill: it must still
   show the old price, while a new order uses the new one.
9. **Export** — `Cafe_Billing_Day_01.xlsx` opens in Excel with both sheets, and
   the Grand Total column sums to the day's sales.
10. **Refresh mid-order** — an unpaid order is still at the counter afterwards.
11. **Backup** — export, restore on a second browser profile, confirm bill count.
12. **Print** — the bill preview prints without the surrounding app chrome.
13. **Tables** — add several at once; each card shows a QR code; **Print all QR
    cards** produces a sheet with nothing but the cards on it.
14. **Scan a table code with a real phone** — the menu opens and names the right
    table.
15. **QR order** — send one from the phone, then take it in at the counter with
    **Scan a customer's code**. The till should show the right items at *your*
    prices, seated at the right table.
16. **Stock** — give an item a recipe, sell it, and check the shelf went down by
    the right amount. Void the bill and check it came back.
17. **Low stock** — set a reorder level above the current level and confirm the
    count appears on the Stock tab.
18. **Rota** — add a shift, edit it, copy a day onto another day.
19. **Attendance** — clock someone in and out, then correct the times and check
    the hours follow.

---

Built for The Baruch Cafe · Coffee • Eats • Community
