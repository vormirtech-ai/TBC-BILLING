# Aasma Buildcon CRM

An offline-first CRM and construction ERP for **Aasma Construction** — leads, clients,
property inventory, projects, materials, labour, daily progress reports, Excel reporting
and an automatic completion-forecasting engine.

Everything runs on one Windows laptop. There is no cloud service, no login server and no
online API: all data lives in a single SQLite file on the machine, and the application
works with the network cable unplugged.

---

## 1. Installing

### Windows (the normal case)

1. Install **Node.js LTS** from <https://nodejs.org> (one time, needs internet) —
   accept every default. If a Command Prompt or Explorer window was already open,
   close it afterwards so Windows picks up the new `PATH`.
2. Unzip this folder somewhere permanent, e.g. `C:\Aasma\aasma-crm`.
3. Double-click **`setup.bat`** and wait. It installs the components, creates the
   database, offers to load sample data and builds the app.
4. Double-click **`start.bat`** to open the CRM.

Only step 1 and 3 need an internet connection. After that the laptop can stay offline
forever.

### macOS / Linux

```bash
npm install
npm run db:setup     # creates the database and loads sample data
npm run build
npm start
```

or just run `./start.command`.

### First sign-in

| Username | Password    |
| -------- | ----------- |
| `admin`  | `admin@123` |

Change it immediately from **Settings → Security**.

---

## 2. Everyday use

| I want to…                        | Where                                                    |
| --------------------------------- | -------------------------------------------------------- |
| See how the business is doing     | **Dashboard**                                             |
| Track an enquiry                  | **Leads** (table or pipeline view)                        |
| Open a customer's file            | **Clients** → click the row                               |
| Update construction progress      | **Projects** → open a site → *Stages* → **Update**        |
| See which flats are unsold        | **Properties** → *Map* view                               |
| Record a cement purchase          | **Inventory** → **Purchase**                              |
| Issue material to site            | **Inventory** → **Issue**                                 |
| Mark today's attendance           | **Labour** → *Daily attendance* → **Save attendance**     |
| Print the monthly wage sheet      | **Labour** → *Monthly sheet* → **Export wages**           |
| File the day's site report        | **DPR** → **File report**                                 |
| Export any register to Excel      | **Reports** → pick a report → **Export to Excel**         |
| Know if a site will finish late   | **Forecasting**                                           |
| Take a backup                     | **Settings → Backup & restore → Back up now**             |

Press **Ctrl + K** anywhere to search leads, clients, units, projects, workers,
materials and daily reports at once.

---

## 3. Modules

**Lead management** — capture, filter and search enquiries; seven-stage pipeline
(New → Contacted → Interested → Site Visit → Negotiation → Won/Lost); follow-up dates
with overdue highlighting on the dashboard; one-click conversion to a client, optionally
booking the unit at the same time.

**Client management** — contact and KYC details, bookings, payment history with
outstanding balance, documents, and a merged timeline of every interaction.

**Property management** — project → tower → floor → unit, with size, price, facing and
status. A colour-coded unit map per tower, and bulk import by pasting rows straight from
a spreadsheet.

**Project management** — multiple sites, each with the seven standard construction stages
(Foundation, Structure, Brick Work, Plaster, Electrical, Plumbing, Finishing), weighted
progress, milestones and a progress history.

**Inventory** — materials by category, purchase entry, issue to site, returns and stock
adjustments. Live stock is *derived* from opening balance + purchases − issues ±
adjustments, so the ledger and the balance can never disagree. Low-stock alerts and a
per-material movement ledger.

**Labour** — worker database (skill, contractor, daily wage), daily attendance with
half-day and overtime, a monthly attendance sheet that doubles as a heat map, and
automatic wage calculation.

**Labour consumption** — labour-days, cost per labour-day, and productivity expressed as
progress delivered per labour-day, broken down by skill and by day.

**Material consumption** — daily / period-wise consumption by material and by value, with
remaining stock alongside.

**Daily Progress Report (DPR)** — weather, work completed, labour count, materials used,
machinery, site issues, safety notes and photos stored on this machine. Optionally issues
the listed materials from stock in the same step. Searchable, date-filtered timeline.

**Forecasting engine** — see section 5.

**Reports** — nine registers (leads, clients, properties, projects, inventory, material,
labour, wages, DPR), each with date filters, search and sorting, and each exportable as a
formatted Excel workbook carrying the company header, typed columns and totals.

---

## 4. What is stored where

```
aasma-crm/
├── data/aasma-crm.db      the entire database — this is the file to keep safe
├── backups/               CRM_Backup_<date>.db files created from Settings
├── uploads/               DPR site photos and client documents
├── reports/               scratch folder for generated exports
├── prisma/schema.prisma   the database schema (16 tables, indexed, foreign keys on)
├── prisma/template.db     empty database copied on a fresh install
├── server/                Express API, services and the forecasting engine
├── electron/              desktop shell (main + preload)
├── shared/                validation schemas and types used by both sides
└── src/                   React + TypeScript interface
```

In a packaged build (`npm run dist`) the data folders live under the Windows user's
application-data directory instead; **Settings → About** shows the exact path, and
**Settings → Backup** has buttons that open those folders.

---

## 5. How the forecast is calculated

The engine uses only what the site team already enters, and shows its working on screen.

1. **Project progress** is the weight-averaged progress of its stages.
2. **Rate of progress** is measured from the recorded progress history: the change in
   overall progress divided by the days between the first and the last update. With fewer
   than two updates it falls back to progress-since-start.
3. **Estimated completion** = today + (remaining work ÷ rate).
4. **Delay** = estimated completion − planned end date. The traffic light is
   **green** on or ahead of schedule, **yellow** within a 5% (minimum 7-day) tolerance,
   **red** beyond it.
5. **Labour required** comes from observed productivity: progress achieved per labour-day
   gives the labour-days still needed, spread over the days left to the planned end date.
6. **Material and cost projections** scale what has been consumed so far by
   `100 ÷ progress%`, and the projected total is compared against the project budget.

Every screen states the assumptions it used ("Rate measured from 6 progress updates
between … and …"), so a number can always be traced back to the data behind it.

---

## 6. Backup and restore

* **Back up now** writes `backups/CRM_Backup_<timestamp>.db` using SQLite's
  `VACUUM INTO`, so the copy is consistent even while the app is running.
* **Save copy** downloads a backup so it can be put on a pen drive.
* **Restore** takes a safety copy of the current data first, swaps the database file, and
  restarts the application.
* A `.db` file from another machine can be uploaded and then restored.

Keep at least one backup off the laptop. The single file `data/aasma-crm.db` is the whole
system — copy it and you have copied everything.

---

## 7. Technology

| Layer      | Choice                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| Desktop    | Electron 33 (single process: Express runs inside the main process)      |
| Interface  | React 18 + TypeScript, Vite 6, Tailwind CSS, Radix primitives, Framer Motion |
| Tables     | TanStack Table  · **Charts** Recharts  · **Icons** Lucide  · **Toasts** Sonner |
| Forms      | React Hook Form + Zod (the same schemas validate on the server)         |
| State      | Zustand                                                                 |
| API        | Express 4, JWT issued and verified locally                              |
| Database   | SQLite via Prisma 6 (WAL mode, foreign keys, indexed)                   |
| Excel      | ExcelJS  · **Dates** Day.js                                             |

### Commands

| Command             | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | Vite dev server + Electron with hot reload              |
| `npm run build`     | Compiles the server, Electron and the interface         |
| `npm start`         | Runs the built desktop application                      |
| `npm run serve`     | Runs without Electron; open <http://localhost:4317>      |
| `npm run db:push`   | Creates or updates the database from the schema         |
| `npm run db:seed`   | Loads the sample data set                               |
| `npm run typecheck` | Type-checks both halves of the codebase                 |
| `npm run dist`      | Builds a Windows installer with electron-builder        |

---

## 8. Security

* Passwords are stored as bcrypt hashes; the password itself is never written down.
* The API listens on `127.0.0.1` only — nothing on the office network can reach it.
* Every request body is validated with Zod before it reaches the database.
* All queries go through Prisma's parameterised client, so input can never be executed
  as SQL.
* Uploaded files are renamed and confined to the uploads folder; backup names are
  resolved with `path.basename`, so a crafted name cannot escape the backups folder.
* The renderer runs with context isolation on and Node integration off; the preload
  script exposes exactly three actions (app info, open folder, restart).

---

## 9. Troubleshooting

**"Node.js was not found"** — first, if Node.js is already installed, close the window
completely and run `setup.bat` again: a Command Prompt opened before the install still
carries the old `PATH`. The script also looks in the usual install folders itself, so
this is only reached when Node really is absent. To install it, either download the LTS
build from <https://nodejs.org> (accept every default) or run
`winget install OpenJS.NodeJS.LTS` in Command Prompt. Check it worked by opening a **new**
Command Prompt and typing `node -v` — it should print something like `v22.11.0`.

**The window opens blank** — run `npm run build` in the application folder, then
`start.bat`.

**"Cannot reach the local service"** — the API did not start. Run `npm run serve` from a
command prompt in this folder to see the reason.

**Port already in use** — the app tries 4317 and then the next free port automatically;
nothing to do.

**Forgotten admin password** — restore a backup taken before the change, or delete
`data/aasma-crm.db` and run `npm run db:setup` to start fresh (this erases all data).

---

© Aasma Construction. Brand palette: crimson `#BC1F43`, accent `#EE3A43`,
mist `#C7C8CA`, steel `#818286`, ink `#231F20`.
