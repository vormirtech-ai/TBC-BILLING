# Aasma Buildcon CRM — website build

These files are the whole application. Upload the **contents** of this folder to
a GitHub repository (or any static host), turn on GitHub Pages, and open the
address it gives you.

- Sign in with **admin** / **admin@123**, then change it in Settings → Security.
- Data is stored in the browser on each computer, and the app keeps working with
  no connection after the first visit.
- To share records between the office and the site, connect **Supabase** (one
  row in a table) or a **private GitHub repository** (one JSON file) in
  **Settings → Sync** on each computer. Every computer keeps its own offline
  copy; syncing merges them record by record, so two people working at once
  never overwrite each other.
- **Settings → Backup & restore → Start fresh** erases the sample records so
  real entries can begin on an empty database, either on this computer or on
  every synced computer.
- Accounts live in **Settings → Accounts**. A **User** account works the site —
  leads, clients, projects, stock, labour and DPRs — and does not see the
  property listing, the tower map or any property prices.
- Take backups from **Settings → Backup & restore**; they download as a `.json`
  file you can restore on another computer.

Rebuild these files with `npm run build:pages` in the project folder.
