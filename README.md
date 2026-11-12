# Trackline: IT inventory and asset management

Stack: React + TypeScript (Vite) frontend, FastAPI (Python) backend, PostgreSQL later.

## Run the frontend

    cd frontend
    npm install
    npm run dev

Open http://localhost:5173. Needs Node 18 or newer.

## Backend and database

See backend/README.md for the step-by-step PostgreSQL, migration, first-admin and run instructions.

## Status

- Frontend: Overview, Inventory, Item detail (with Documents), Add/Edit, Spares, Alerts, Reports, Audit trail, Approvals, Master data and Users all work against the API. Sign-in is required; the role decides what you can do.
- Backend on PostgreSQL: login, sessions, users (Administrator, Inventory Manager, OIC/User, Viewer), audit log, items and their history, master data, approvals, and document attachments. Business rules (status changes, stock limits, member approval) are enforced on the server.
- Documents: upload, view (PDF and images open in the app), download and remove. Files live in a storage folder (`STORAGE_ROOT`), organised `Assets|Licenses|Spares / item ID / document type`. Uploads that need approval wait for an admin or inventory manager.
- Export: "Excel" downloads a real .xlsx workbook; "PDF" uses the browser print dialog.
- Bulk import (admins and inventory managers): Import page, download the Excel template, fill it in, upload and Check, fix problem rows on the page (or upload a corrected file), then Import. All rows must be clean by default; "import only the valid rows" is a separate, deliberate option and the skipped rows can be downloaded. New item IDs are created automatically. A project, vendor, location or department that is not in Master data yet can be added from the review screen (admins directly; for an inventory manager's import, when an admin approves it), or the rows can be switched to an existing value. Items have an Item name (what it is called) and an optional Description (what it is used for). Costs are in SGD. Where an inventory manager's changes need approval, the whole import waits for approval as one request.
- Spares keep a stock movement log (date, in or out, quantity, balance, reason, who). Assets have separate warranty / support fields; vendor contact details show from Master data.
- Not built: license seat allocations, virus scanning of uploads.

## Where things are

- frontend/src/api/ holds the calls to the server. Nothing is kept in browser storage any more.
- frontend/src/lib/rules.ts only describes actions for the screen (which buttons to show, alert wording). The real rules are in backend/app/services/rules.py and items.py.
- Sample data: `python -m app.seed_demo --items` (see backend/README.md).

## Layout

    frontend/src/
      api/         calls to the backend (items, requests, masters, documents, auth)
      lib/         display rules and helpers
      components/  Layout, badges, action dialog, documents panel
      pages/       Dashboard, Inventory, ItemDetail, ItemForm, Spares, Alerts,
                   Reports, AuditTrail, MasterData, Approvals, Users, Login
      types.ts     shared types
    backend/app/     FastAPI app: routers/ (web), services/ (rules), storage.py (files), models.py
    backend/alembic/ database migrations
