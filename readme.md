# Orbit

A personal project management web app inspired by Trello and Microsoft Planner. Organize work into projects, break them into kanban-style buckets, and track tasks and risks — complete with RPN scoring, file attachments, bucket colors, drag-and-drop reordering, and dark mode.

---

## Features

- **Projects** — create and manage projects with cover images, tags, and favorites; favorite projects are pinned to the top
- **Kanban boards** — unlimited buckets per project with custom header colors, inline storyboard notes, and drag-and-drop column reordering
- **Tasks** — priority levels (Low / Medium / High), due dates, picture attachments, tags, and completion tracking; drag-and-drop tasks between buckets; done tasks collapse into a "✓ N Done" section per column; checklist items (sub-tasks) per task with per-item completion and a progress badge on the card; soft ding sound and shine animation on completion; confetti celebration on the 10th completed task; **duplicate button** on each card copies the description (appends "-Copy"), tags, and checklist items into a new task and opens the edit modal immediately
- **Risk management** — severity / probability / detectability scoring with automatic RPN calculation (S × P × D), solution tracking, and status (Open / Resolved); risks shown in a dedicated board column that can be hidden per-project via the **Add risk bucket** toggle in Edit Project (data is preserved and restored when re-enabled)
- **Notifications** — bell icon in the navbar shows overdue (incomplete, past-due) tasks; hover to reveal a dropdown list; bell fill color reflects severity: yellow (1–10), orange (11–20), brown (21–30), light red (31+). On the Projects page all overdue tasks are shown; on a Board page only that project's overdue tasks appear
- **Authentication** — JWT-based login with password visibility toggle, registration with email verification (link expires in 30 minutes), forgot/reset password via email (SMTP); all form validation uses in-app toast notifications (no browser tooltips)
- **Profile** — display name, avatar upload, password change, dark / light mode toggle, delete account
- **Security** — Argon2id password hashing, AES-256-GCM email encryption at rest, Helmet security headers, CORS origin restriction, CSRF origin check, rate limiting, cookie-authenticated file uploads, self-hosted fonts, UUID-randomised upload filenames, XSS escaping, timing-attack mitigation on forgot-password

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS (ES modules), SPA with hash-based routing |
| Backend | Node.js + Express 4 |
| Database | SQLite via `node-sqlite3-wasm` (no native compilation required) |
| Auth | JSON Web Tokens — 7-day expiry, httpOnly SameSite=Strict cookie (Bearer header also accepted) |
| Password hashing | Argon2id via `hash-wasm` (WASM, no native build needed) |
| File uploads | Multer — jpg/png/jpeg only, UUID filenames |
| Email | Nodemailer via SMTP (console fallback when not configured) |
| Security headers | Helmet (CSP, HSTS, etc.) |
| Rate limiting | `express-rate-limit` |
| Config | `dotenv` — environment variables from `server/.env` |
| Dev | `nodemon` |

---

## Project Structure

```
Orbit/
├── assets/                  # Design assets and icons
├── client/                  # Frontend SPA (served as static files)
│   ├── index.html
│   ├── favicon.ico
│   ├── icon-light-512.png
│   ├── icon-dark-512.png
│   ├── css/
│   │   └── style.css
│   ├── fonts/              # Self-hosted web fonts (DM Sans, Syne)
│   └── js/
│       ├── app.js           # Bootstrap, auth guard, route registration
│       ├── api.js           # Fetch wrappers for all API calls
│       ├── router.js        # Hash-based SPA router
│       ├── utils.js         # toast, showModal, escHtml, tagsInput, etc.
│       └── pages/
│           ├── login.js
│           ├── register.js
│           ├── forgot-password.js
│           ├── verify-email.js
│           ├── projects.js
│           ├── board.js
│           ├── profile.js
│           └── admin.js         # Dynamically imported; admin API defined locally (not in api.js)
└── server/                  # REST API
    ├── server.js            # Express app, middleware, route mounts
    ├── .env                 # Local config (not committed)
    ├── models/
    │   └── db.js            # SQLite init, migrations, Statement wrapper
    ├── routes/
    │   ├── auth.js
    │   ├── projects.js
    │   ├── buckets.js
    │   ├── tasks.js
    │   ├── checklists.js
    │   ├── risks.js
    │   ├── profile.js
    │   └── admin.js
    ├── middleware/
    │   └── auth.js          # requireAuth, requireAdmin, signToken (JWT)
    ├── utils/
    │   ├── hash.js          # hashPassword (Argon2id), verifyPassword, sha512, email encryption
    │   └── email.js         # sendPasswordResetEmail, sendVerificationEmail
    ├── uploads/             # Uploaded images (auto-created, gitignored)
    └── data/                # SQLite database file (auto-created, gitignored)
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (bundled with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/sdebby/orbit.git
cd orbit

# Install server dependencies
cd server
npm install
```

No frontend build step is needed — the client is plain HTML/CSS/JS served directly by the Express server.

### Configuration

Create `server/.env` (copy the template below and fill in your values):

```env
# Server
PORT=3000
APP_URL=http://localhost:3000

# Security — generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=your-64-byte-hex-secret

# Email at-rest encryption (AES-256-GCM) — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Keep this stable — changing it requires re-encrypting all stored emails
EMAIL_ENCRYPTION_KEY=your-32-byte-hex-key

# Admin access — the user with this email gets admin privileges (never stored in DB)
SUPER_ADMIN_EMAIL=your@email.com

# Email (SMTP) — required for registration verification and forgot-password emails
# Gmail: use an App Password from https://myaccount.google.com/apppasswords
# For gmail use:
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your@gmail.com

# For GoDaddy microsoft account use
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=587
SMTP_SECURE=false          # false = STARTTLS on port 587
SMTP_USER=you@yourdomain.com
SMTP_PASS=your_microsoft365_password
SMTP_FROM=you@yourdomain.com

# Set to 'production' to enable secure (HTTPS-only) cookies
NODE_ENV=development
```

> Without SMTP configured, all email links (verification, password reset) are printed to the server console instead of being sent.

---

## Running the Server

> **Important:** The server must be started from inside the `server/` directory.

### Development (auto-restart on file changes)

```bash
cd server
npm run dev
```

### Production

```bash
cd server
npm start
```

The app will be available at **[http://localhost:3000](http://localhost:3000)**

The SQLite database and uploads folder are created automatically on first run inside `server/data/` and `server/uploads/`.

---

## Stopping the Server

Press `Ctrl + C` in the terminal where the server is running.

If the process is stuck, force-kill it:

```bash
# Windows
taskkill /F /IM node.exe

# macOS / Linux
pkill -f "node server.js"
```

---

## Registration & Email Verification

New accounts require email verification before sign-in is allowed:

1. User registers with email and password
2. A verification link is sent to their email (expires in **30 minutes**)
3. Clicking the link activates the account
4. User can then sign in normally

Existing accounts created before this feature was introduced are automatically marked as verified.

---

## Security

| Area | Implementation |
|------|---------------|
| Passwords | Argon2id with random salt (via `hash-wasm`) |
| Email storage | AES-256-GCM encryption at rest (`EMAIL_ENCRYPTION_KEY`); SHA-512 hash for constant-time lookup |
| Tokens | JWT in httpOnly `SameSite=Strict` cookie; 7-day expiry; Bearer header also accepted |
| Session fixation | Existing cookie cleared before issuing a new one at login |
| Email verification | Random 32-byte hex token, expires in 30 minutes; rate-limited (10 req / 15 min) |
| Password reset | Random 32-byte hex token, expires in 1 hour |
| Auth rate limiting | 20 req / 15 min on register/login; 5 req / hour on forgot-password |
| CSRF | `Origin` / `Referer` header checked on all mutating requests |
| Security headers | Helmet with CSP (`self` + `unsafe-inline` for styles) |
| CORS | Restricted to `APP_URL` env var only |
| File uploads | MIME type + extension whitelist (jpg, jpeg, png); UUID filenames; authenticated via httpOnly cookie |
| Body size | 10 KB JSON body limit; multipart form field values capped at 10 KB (`fieldSize`); oversized input returns 4xx |
| Input validation | `tags` fields validated as `string[]` at ingestion — non-array or non-string elements return 400 |
| HTML stripping | All free-text fields (description, title, tags, username, checklist text) stripped of HTML tags server-side before DB write |
| XSS (client) | All user content escaped via `escHtml()` before DOM insertion — second layer after server-side stripping |
| Admin isolation | `admin.js` dynamically imported; admin status verified server-side at render time; admin API endpoints not in the shared `api.js` bundle |
| Admin role | Derived from `SUPER_ADMIN_EMAIL` env var at request time — never stored in DB |
| Password policy | Min 8 characters, uppercase, number, and special character required |
| Timing attacks | Forgot-password always responds after a minimum 300 ms delay |
| Fonts | Self-hosted (no external requests to Google Fonts) |
| Dependency CVEs | `npm overrides` pin `path-to-regexp@0.1.13`, `picomatch@2.3.2`, `brace-expansion@5.0.5` to patched versions (ReDoS / method-injection fixes) |

---

## API Overview

| Resource | Endpoints |
|----------|-----------|
| Auth | `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · `GET /api/auth/verify-email/:token` · `POST /api/auth/forgot-password` · `POST /api/auth/reset-password/:token` |
| Profile | `PUT /api/profile` · `DELETE /api/profile` |
| Projects | `GET /POST /api/projects` · `GET /PUT /DELETE /api/projects/:id` · `PUT /api/projects/:id/favorite` |
| Buckets | `GET /POST /api/projects/:id/buckets` · `PUT /DELETE /api/buckets/:id` |
| Tasks | `GET /POST /api/buckets/:id/tasks` · `GET /PUT /DELETE /api/tasks/:id` · `GET /api/tasks/overdue` |
| Checklists | `GET /POST /api/tasks/:id/checklists` · `PUT /DELETE /api/checklists/:id` |
| Risks | `GET /POST /api/projects/:id/risks` · `GET /PUT /DELETE /api/risks/:id` |

All authenticated endpoints read the JWT from the httpOnly `orbit_token` cookie (set at login). The `Authorization: Bearer <token>` header is also accepted for API clients that can't use cookies.

---

## License

MIT
