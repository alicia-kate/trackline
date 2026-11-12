# Trackline backend: database and login setup (Windows)

## 1. Install PostgreSQL
Download the installer from postgresql.org. Keep the default port 5432 and the command-line tools. Set a password for the `postgres` superuser and remember it.
Check in a new terminal: `psql --version`. If it is not found, add `C:\Program Files\PostgreSQL\<version>\bin` to PATH.

## 2. Create the database and an app user
    psql -U postgres
    CREATE ROLE trackline_app WITH LOGIN PASSWORD 'choose-a-strong-password';
    CREATE DATABASE trackline OWNER trackline_app;
    \q

The app uses its own limited user, never the `postgres` superuser.

## 3. Python environment
    cd backend
    python -m venv .venv
    .venv\Scripts\activate
    pip install -r requirements.txt

## 4. Configure
    copy .env.example .env
Edit `.env` and set the password in `DATABASE_URL`. If the password has special characters (@ : / # %), URL-encode them. Never commit `.env`.

## 5. Create the tables
    alembic upgrade head

## 6. Create the document storage folder
Uploaded files are kept in a folder, not in the database. Create it once, then set `STORAGE_ROOT` in `.env` to its full path (forward slashes are fine on Windows):

    STORAGE_ROOT=C:/trackline-storage

Files are filed by item, never by project: `Assets\AST-1001\Invoice\<random-name>.pdf`. The project is stored in the database, so an item can change project without any file moving. Never rename, move or delete files in this folder by hand: the database points at them.
If the folder is inside OneDrive, right-click it and choose "Always keep on this device" so files are never online-only placeholders.

## 7. Create the first admin
    python -m app.create_admin
You choose the username and password. There is no default account.

## 8. Load starter data
    python -m app.seed_demo            (projects, vendors, locations, departments)
    python -m app.seed_demo --items    (the same, plus 10 sample items)
Safe to run twice. Skip `--items` for a real register and enter items in the app.

## 9. Run the API
    uvicorn app.main:app --reload
API docs: http://127.0.0.1:8000/docs

## 10. Run the frontend
    cd ..\frontend
    npm run dev
Open http://localhost:5173 and sign in.

## Check what is stored
    psql -U trackline_app -d trackline -h localhost
    \dt
    SELECT username, role, left(password_hash, 20) FROM users;
    SELECT action, actor_username, occurred_at FROM audit_log ORDER BY id DESC LIMIT 10;
The hash column starts with `$argon2id$`: passwords are never stored in readable form.

## Tables
- users: username (lowercase, unique), full_name, password_hash, role (admin, manager, oic, viewer), is_active, must_change_password, failed_login_count, locked_until, last_login_at
- user_sessions: hashed session token, user, expiry
- audit_log: sign-ins, failed sign-ins, user changes, password changes, item changes, approvals, document uploads and removals
- items: the register (assets, licenses, spares). `mg_no` is unique; asset serial numbers are unique. `warranty_expiry` and `warranty_info` are for assets; `expiry_date` is the license renewal date
- stock_movements: one row per stock in / stock out of a spare (date, direction, quantity, balance after, reason, issued to, who)
- item_history: every custody and lifecycle event for an item
- master_data: projects, vendors, locations, departments
- change_requests: changes and uploads waiting for an admin or inventory manager to approve or reject (never the person who made them)
- attachments: one row per uploaded document (original name, type, size, checksum, who, when, status). Removing a document only marks it deleted

## Roles
| Role | Sees | Can do |
|---|---|---|
| admin (Administrator) | everything | everything: users, projects and other master data, settings, approvals |
| manager (Inventory Manager) | everything | the same as admin except creating and managing user accounts; also gives OIC/Users project access. Changes apply at once unless `MANAGERS_NEED_APPROVAL=true` |
| oic (OIC/User) | only items in the projects assigned to them | add, edit, bulk import and run any action in those projects; every change waits for approval. Can ask for access to another project |
| viewer | everything | nothing (read-only) |

- Approval: admin changes apply at once. With `MANAGERS_NEED_APPROVAL=true` (the default) an Inventory Manager's changes wait for an admin or another manager. With `false` they apply at once. An OIC/User's updates always wait. Nobody can approve their own request.
- Projects: an OIC/User account must have at least one project (chosen by the admin when creating it, changed later by an admin or inventory manager). An OIC/User asking for another project creates an access request that an admin or inventory manager approves.
- Documents on a new item: files are uploaded first (`POST /api/uploads`, status staged) and then sent with the item. When the item waits for approval, its documents wait with it and the approver can open them from the Approvals page; approving adds the item and the documents together, rejecting rejects both.
- Documents: one document can be linked to several items (an admin or inventory manager uses Share on a document; Migration 0007 links existing documents to the item they were uploaded on). A project or vendor page lists the documents of all its items. An OIC/User only sees documents linked to items in their projects.
- Bulk import: new Master data (for example a new project) in an import from anyone but an admin always waits for an admin or inventory manager to approve it. An OIC/User cannot add new Master data and can only import into their own projects.

## Bulk import
`GET /api/import/template` builds the Excel template from the current Master data. `POST /api/import/check` reads an uploaded .xlsx and checks every row (nothing is saved). `POST /api/import/check-rows` re-checks rows after edits. `POST /api/import/commit` saves them in one transaction, or queues them as a single approval request when the person's changes need approval. Limits: .xlsx only, 5 MB, 1,000 rows. Cells are read as values only (formulas are never run). New Master data the person agreed to add is created in the same transaction as the items (admin, and a manager unless `MANAGERS_NEED_APPROVAL=true`, in which case it is created when an admin or another manager approves). Every row is checked again on the server at save time, and an import writes one audit line plus a history line per item.

## Upgrading an existing database
    alembic upgrade head
Migrations 0003 to 0008 add the roles, warranty fields, stock log, import approvals, the item Description field and project access for OIC/Users (0006 gives existing OIC/Users the projects of the items they were already named on). Migration 0003 turns existing `member` users into `manager`, moves each asset's old expiry date into `warranty_expiry` (license renewal dates stay in `expiry_date`), and copies the old stock in/out history into `stock_movements`. Take a backup first (below).

## Backup
Two things must be backed up together: the database (all records) and the storage folder (the uploaded files). The database only points at the files, so one without the other is not a full backup.

Database (Windows, from a command prompt; it asks for the `trackline_app` password):

    pg_dump -U trackline_app -h localhost -Fc -f D:\backups\trackline-2026-11-10.dump trackline

Uploaded files (copies new and changed files, never deletes in the backup):

    robocopy "D:\path\to\trackline-storage" "D:\backups\trackline-storage" /E /XO

Restore on a fresh machine: create the empty database and user (steps 1 and 2 above), then

    pg_restore -U trackline_app -h localhost -d trackline --clean --if-exists D:\backups\trackline-2026-11-10.dump

and copy the storage folder back to the path set in `STORAGE_ROOT`. Run the backup every day with Windows Task Scheduler, keep several days, and keep at least one copy on another machine or drive. Do a test restore now and then; a backup that has never been restored is not proven.

## Security measures in this build
- Passwords hashed with Argon2id; plain passwords are never stored or logged
- Session token is random, stored only as a SHA-256 hash, and sent as an HttpOnly, SameSite=Lax cookie (set COOKIE_SECURE=true under HTTPS)
- Same generic error for wrong username, wrong password, inactive and locked accounts; password check is still run for unknown usernames to even out timing
- Account locks for 15 minutes after 5 failed attempts
- State-changing requests need an `X-Requested-With` header (CSRF guard on top of SameSite)
- Admin-created accounts get a temporary password and must change it at first sign-in
- Changing or resetting a password signs out the other sessions; deactivating a user signs them out
- Admins cannot demote or deactivate themselves, and the last active admin is protected
- Password rules: 10 to 128 characters, must not contain the username
- Role is read from the database on every request, not from the cookie
- Login and user changes are written to audit_log
- Members cannot change items directly: the server queues their changes for an admin. Viewers can only read
- Uploads: PDF, JPG, PNG, xlsx, docx only, up to MAX_UPLOAD_MB (10). The start of the file must match its type (and xlsx/docx must be real Office files). Files are saved under a random name, never the uploaded name, and are served only through the API after sign-in

## Before real use
Set `COOKIE_SECURE=true` and `DOCS_ENABLED=false`, serve over HTTPS, and schedule regular `pg_dump` backups. Back up the database and the storage folder together: each is incomplete without the other.
