# Handover

For whoever maintains this after us. It assumes you can read JavaScript and
have never seen this codebase.

---

## The shape of it

```
saba-pos/
├── server/                  the till computer
│   ├── main.js              the HTTP pipeline, boot and shutdown
│   ├── api.js               every endpoint, and the access policy table
│   ├── store.js             the authoritative state; the only writer
│   ├── auth.js              PINs, sessions, roles and abilities
│   ├── reporting.js         the day report, the range report, the exports
│   ├── live.js              the SSE fan-out
│   ├── seed.js              first run, and the worked example
│   ├── config.js            every environment variable, with its default
│   ├── db/
│   │   ├── index.js         the only module that touches SQLite
│   │   └── schema.sql       the whole schema, idempotent
│   └── http/kit.js          routing, cookies, static files, JSON, downloads
│
├── app/                     every screen, served as-is
│   ├── index.html           the shell
│   ├── styles/app.css       the whole design system, one file
│   └── src/
│       ├── shared/          ← pure domain logic, run on BOTH sides
│       ├── core/            the DOM helper, the router, the replica
│       ├── net/             the HTTP client and the live link
│       ├── ui/              components, icons, the shell, printing
│       ├── views/           one file per screen
│       └── state.js         the façade the views talk to
│
├── tests/                   unit (pure functions) and api (a real server)
├── tools/                   assets, backup, restore
└── docs/                    these
```

About 16,000 lines, no dependencies, no build step. What you check out is
what runs.

---

## The five decisions everything else follows from

### 1. The domain logic is shared, not duplicated

`app/src/shared/` is imported by the browser over HTTP *and* by the server
with a relative path. The same `costOrder()` adds up the bill the captain is
looking at and the bill the server stores. They cannot drift, because they
are the same function.

Everything in `shared/` must therefore be pure: no DOM, no `node:`, no
secrets, no I/O. That rule is the whole reason the arrangement works. If you
need a browser API or a database in there, you have put the code in the wrong
place.

### 2. One writer, one revision, dumb terminals

Every write goes through `server/store.js`, inside a transaction, and bumps a
single integer in `meta.revision`. The server broadcasts **only that number**
over SSE. A terminal that sees a number higher than its own refetches the
whole working set.

No deltas, no patches, no merge, no conflict resolution — because there is
nothing to merge. The cost is a few kilobytes per change; the benefit is that
"two terminals settled the same table at once" is a 409 rather than a
corrupted bill.

The browser's replica is `app/src/core/store.js`. It is the only thing that
holds state, and `adopt()` is the only way state enters it — which is why the
tariff and the floor plan are applied there.

### 3. Money is integer paise, everywhere

Every amount in the database, in the API and in the arithmetic is a whole
number of paise. Rupees exist only in `money.js`'s formatter and in the
inputs an owner types into. There is no float anywhere near a total, so the
printed lines always add to the printed total.

`pricing.js` documents the order of operations at the top. That order is the
part auditors check and the part people get wrong. Do not reorder it without
reading the comment.

### 4. Permission is a table, not a habit

The bottom of `server/api.js` holds `POLICY` — one line per endpoint, saying
what it needs:

```js
'POST /api/orders/:id/reopen': { screen: '/bill', ability: 'reopen' },
'POST /api/backup':            { ability: 'backup' },
'GET  /api/health':            { open: true },
```

`applyPolicy()` runs at import and **throws at startup** if a route has no
policy or a policy has no route. You cannot add an endpoint and forget to
protect it: the server will not boot.

Roles map to screens (`ROLE_ROUTES`) and to abilities (`ROLE_ABILITIES`) in
`app/src/shared/config.js`. Changing what a cashier may do is an edit to one
object.

### 5. An order is a document

The `orders` table holds a JSON document with the columns you want to query
lifted out beside it (`table_id`, `status`, `day`, `opened_at`). That is what
lets the same pure functions in `shared/orders.js` operate on an order in the
browser and on the server without a mapping layer.

It is a deliberate trade. Reporting over 30 days of documents is a scan
rather than an index — measured at about 40ms for a month of trading on a
Raspberry Pi, which is fine, and would not be at a thousand covers a night. If
the restaurant ever gets there, the move is to materialise a `bill_lines`
table on settle and report from it; nothing else has to change.

---

## The published demonstration

`app/src/net/till/` is a till that runs in the browser, so the whole
application can be published as a static site with nothing behind it. It is
the thing a client clicks before they buy.

It is **not** a second implementation. Every state transition and every
figure comes from `app/src/shared/` — the same `costOrder`, the same
`fireCourse`, the same `buildWorkedExample`, the same `buildDayReport`. What
`till/` adds is only what the server does with SQLite: holding the documents,
handing out numbers, keeping the audit log. The seam it plugs into is one
line in `net/api.js`:

```js
const transport = (path, init) =>
  (globalThis.SABA_TILL ? globalThis.SABA_TILL(path, init) : fetch(path, init));
```

Two rules keep it honest, and both matter more than they look:

1. **Anything the demonstration needs that is domain logic goes in
   `shared/`, never in `till/`.** That is why `takings.js` takes a `source`
   rather than reaching for a database, and why `worked-example.js` is a pure
   generator. When you find yourself about to write business logic in
   `till/`, you have found the next thing to move into `shared/`.
2. **`tests/till/parity.test.mjs` must keep failing when they drift.** It
   runs a service — modifiers, a comp, an approved discount, a part payment,
   with and without the service charge — through the real server and through
   the till, and compares every line of the bill. If you weaken it, you have
   removed the only thing stopping the demonstration from quietly lying.

The demonstration's PINs are in the clear and its sign-in compares them
directly. That is deliberate and stated on the page. Do not be tempted to
make it look more secure than it is; it holds nothing worth securing, and
pretending otherwise would be the dishonest part.

## Things a restaurant configures (do not hard-code them again)

Four things used to be constants and are now stored in `settings`, loaded at
boot and pushed into the shared modules:

| Setting | Stored as | Loaded by | Pushed into |
|---|---|---|---|
| `restaurant` | the bill header | — | read directly |
| `charges` | service charge, tax components, rounding, approval threshold | `store.loadCharges()` | `pricing.useCharges()` |
| `floorplan` | rooms and tables | `store.loadFloorPlan()` | `floorplan.useFloorPlan()` |
| `printing` | bill format, watermark | — | read directly |

The pattern is the same for all of them, and worth following for the next
one:

1. The constant in `shared/` stays, as the shape and the fallback.
2. The shared module gets `useX(next)` and an `x()` accessor. Nothing caches
   the result of `x()`; it is read at the moment it is needed.
3. The server validates on write (`validateCharges`, `validateFloorPlan`),
   stores it, and **after the transaction commits** calls `loadX()`.
4. The browser applies it in `core/store.js`'s `adopt()`, which is the single
   point every piece of new data passes through.

That ordering matters: validating before the write stops a typo becoming a
tax rate, and loading after the commit stops a rolled-back transaction
leaving the server costing bills with a tariff the database does not hold.

The menu is a database table (`menu_items`, one JSON doc per dish), not a
setting; `shared/catalogue.js` only seeds it.

---

## How to do the things you will be asked to do

### Add a screen

1. A view file in `app/src/views/`, exporting `renderX(host)`.
2. A route in `app/src/core/router.js`.
3. A rail entry in `app/src/ui/shell.js`.
4. Add its path to the roles that may open it in `ROLE_ROUTES`.
5. Its endpoints go in `api.js` **and** in `POLICY`, or the server will not
   start.

### Add a role

`ROLES`, `ROLE_LABELS`, `ROLE_ORDER`, `ROLE_ROUTES` and `ROLE_ABILITIES` in
`app/src/shared/config.js`. Nothing else. The server reads the same objects.

### Change the tax rules

If it is a rate, it is already configurable — Setup → Charges. If it is the
*arithmetic* (tax-inclusive pricing, a cess, a different order of
operations), it is `costOrder()` in `app/src/shared/pricing.js`, and it needs
a test in `tests/unit/pricing.test.mjs` before and after.

Tax-inclusive pricing is the one thing deliberately left out:
`pricesIncludeTax` is forced to `false` by `validateCharges`. Supporting it
properly means backing the tax out of every menu price and reversing it on
the bill, which touches the menu editor, the printed bill and every report.
It is a day's work, not an afternoon's, and no part of it should be bolted on
quietly.

### Change the schema

Add to `schema.sql` with `IF NOT EXISTS` — it runs on every boot and is safe
against an existing database. Anything that cannot be expressed that way (a
column added to an existing table, a backfill) is a numbered step in
`migrate()` in `server/db/index.js`, and `SCHEMA_VERSION` goes up. Steps are
forward-only. Never edit a step that has shipped.

### Add an endpoint

```js
router.post('/api/thing', async (req, res, ctx) => { … });
// and, at the bottom:
'POST /api/thing': { ability: 'settings' },
```

`ctx` carries the signed-in `user`, the `address` and the session helpers.
Throw `badRequest`/`notFound`/`conflict`/`forbidden` from `http/kit.js`; the
message reaches the user verbatim, so write it for them.

Any write returns the order it changed where there is one, so the terminal
that issued it repaints immediately instead of waiting for its own broadcast
to come back around.

---

## The cloud copy

`server/sync/` mirrors the till into a Supabase project, when one is
configured. Three files and a table:

- **`tables.js`** — the one place that says what syncs and which way. If the
  answer to "does this reach the cloud, and can the cloud change it?" is not
  a line you can read there, something has gone wrong.
- **`supabase.js`** — PostgREST over `fetch`. A hundred lines rather than a
  dependency, because the product has none.
- **`index.js`** — the loop: push, then pull the configuration back.

The design is a **high-water mark per table**, not a change log. Each pass
sends rows whose `updated_at` is above the mark, then advances it. There is
nothing to keep in step with the writes, a crash mid-batch resends at worst
(and an upsert absorbs it), and a till off for a week catches up by the same
path as one off for a minute.

Four rules worth keeping:

1. **Bills go up only.** `direction: 'push'` for anything that records what
   happened. Nothing in the cloud may rewrite a settled invoice, and a
   second writer of a tax record is a problem nobody needs.
2. **PINs never leave.** `NEVER_SEND` holds `pin_hash` and `pin_salt`. The
   cloud has no column for them and the pull would not accept one. Making a
   compromised Supabase project into a way into the till is the one failure
   here that would actually hurt somebody.
3. **A sync must never interrupt service.** Every path is wrapped; a failure
   is recorded and retried. If you add a call site, it does not throw at
   somebody holding a card machine.
4. **The key is service-role.** It stays in the till's environment: never in
   a reply, never in the database, never in the log — `supabase.js` has a
   `redact` for the last of those.

Totals are the one thing computed on the way out rather than stored: the
sync runs the shared `costOrder` and sends the result, so the cloud's tax
column is by definition the figure printed on the guest's bill. Re-deriving
it in SQL would be a second implementation of the arithmetic an auditor
checks first.

The sync's own logic is tested everywhere against a PostgREST stand-in
(`tests/sync/`). The SQL in `supabase/` is tested against a real PostgreSQL
by `tools/verify-cloud.mjs`, which loads a seeded till into it and checks the
views add up to the same figures the till's own day report shows. Run that
when the SQL changes; it is not in `npm test` because the suite must not
need a database server.

## Things that will bite you

**`node:sqlite` is experimental.** It prints a warning on every start, and
Node may change it. That is why the Docker image pins an exact Node and why
every call goes through `server/db/index.js`. Swapping in `better-sqlite3` is
a half-hour job in that one file — the API is nearly identical — and would
cost the project its "no dependencies" property.

**Prepared statements belong to a connection.** `db/index.js` caches them and
clears the cache in `closeDatabase()`. Do not cache a statement anywhere
else.

**`server.keepAliveTimeout` is 72 seconds**, because a kitchen display holds
its stream open all service. `server.shutdown()` therefore calls
`closeIdleConnections()` explicitly; without it a restart waits out that
timeout on every terminal that has merely gone quiet. The test harness uses
the same `shutdown()`, which is why the suite takes eight seconds and not
eighty.

**`start()` installs no signal handlers.** `installSignalHandlers()` does,
and only the command line calls it — otherwise seventy test servers each add
four process listeners.

**The watermark needs HTTP.** It is a CSS `mask` on a PNG, which browsers
treat as cross-origin on `file://`. Opening `app/index.html` off the disk
shows no watermark. Serve it.

**Sign-in names the user first.** `POST /api/session` requires a `userId`,
because checking the PIN against every account meant one scrypt per member of
staff — two seconds at the terminal with twenty staff. An unknown id still
pays the cost of a decoy hash so a stopwatch cannot enumerate accounts.

**Manager approval is still PIN-only** (`POST /api/authorise`), because the
person approving is not the person signed in. It is bounded by filtering to
accounts that actually hold the ability, which is normally one or two people.

**Timestamps must be whole numbers.** SQLite will keep a fractional
millisecond if some arithmetic produces one; Postgres rejects the batch. The
sync rounds at the boundary, and the worked example that first produced one
was fixed at its source. If you compute a time, round it.

**The business day rolls at 05:00**, not midnight (`DAY_ROLLOVER_HOUR`). A
service that runs to two in the morning belongs to the night before. Every
report, every counter and the day-close all use `businessDay()`; never use
`new Date().toDateString()`.

---

## Tests

```sh
npm test
```

- `tests/unit/` — the pure functions, in-process, instant.
- `tests/api/` — a real server, a real SQLite database, real HTTP, one
  freshly started per case on its own port with its own temporary directory.
  Nothing is mocked.

`tests/run.mjs` is a ninety-line runner. `SABA_TEST_TRACE=1` prints stack
frames and the slowest cases.

Add a test with the behaviour, not after it. The suite is the only thing that
will tell you that the thing you changed in `pricing.js` quietly altered what
a split bill charges.

---

## What was left out, and why

- **Tax-inclusive pricing.** See above.
- **A drag-and-drop floor plan.** Tables carry an x/y on a 100×100 grid per
  room and the Setup editor places a new one in the first free spot. Dragging
  them is a nice afternoon's work; nobody has needed it.
- **Printer drivers.** Saba prints through the browser's own dialogue. A
  restaurant with an ESC/POS printer on the network would want a small print
  agent; the bill and ticket documents in `ui/print.js` are already
  structured for it.
- **Multi-site.** One server, one restaurant. The licence says so and the
  schema assumes it.
- **Any outbound connection at all.** There is no telemetry, no update check,
  no licence call. Keep it that way — it is the thing the product is sold on.
