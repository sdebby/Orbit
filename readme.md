# Orbit — Kanban Project Manager

[Orbit-tracker web site](https://orbit-tracker.app)
> A personal, self-hosted project management web app inspired by Trello and Microsoft Planner — with built-in risk tracking, email reminders, and a clean dark/light UI.

---

## Features

### Kanban Board
- Drag-and-drop columns (buckets) and task cards
- Per-column storyboard notes with inline auto-save
- Custom column colors
- Real-time task search & tag filtering
- Board banner image from project cover photo
- Keyboard shortcuts in modals: **ESC** to cancel, **Ctrl+Enter** to confirm

### Task Management
- Priority levels: Low / Medium / High
- Due dates with color-coded urgency (overdue, due-soon, upcoming)
- Inline checklists with progress tracking
- Task completion with timestamp; collapsible "Done" section per column
- Image attachments (thumbnail shown on card)
- Duplicate task with one click
- Email reminder at 8:00 AM on the due date

### Risk Tracking
- Dedicated Risks column per project (can be toggled)
- Severity × Probability × Detectability → RPN score
- Solution description and photo attachments
- Open / Resolved status

### Project Sharing
- Owner-driven invitations by email — pick **Viewer** or **Editor** role per recipient
- Avatar stack on each shared card; "Shared" chip and role pill so collaborators always know what they can do
- Recipient gets an email notification; unregistered emails get a 7-day invite link that doubles as a one-step register-and-accept flow
- Pending invites are auto-promoted to real shares when the email signs up later — no second click required
- Revoke = **fork**: the revoked user keeps an independent copy of the project (data + uploaded files), so no one loses work
- Last-write-wins concurrent editing; no conflict resolution UI
- **Workspaces for shared projects**: each recipient has their own per-share workspace assignment. New shares land in an auto-created "Shared Projects" workspace; recipients can move them anywhere from the project card ⋮ menu
- Invite POST rate-limited (15 / 15 min per IP) to prevent SMTP abuse; member emails are never exposed via the projects-list API — only the owner-only share modal sees them

### Email Notifications
- Task due-date reminder emails
- Configurable digest emails: Off / Daily / Every 3 days / Weekly / Every 2 weeks
- Digest groups pending tasks by project and bucket with overdue items highlighted

### Profile & Preferences
- Dark / light theme toggle — preference stored per account and synced across all devices
- Configurable digest email frequency
- Avatar upload and display name

### Authentication & Security
- JWT in httpOnly, SameSite=Strict cookie
- Argon2id password hashing
- AES-256-GCM encrypted email storage
- Email verification on registration
- Rate-limited auth and forgot-password endpoints
- CSRF origin check, helmet security headers

### Admin Panel
- User statistics dashboard (total, online now, registered today/last 7 days)
- Paginated searchable user list
- User detail drawer with project/task/risk counts
- Bulk delete, send password-reset email

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS SPA (no framework), ES modules, hash-based routing |
| Backend | Node.js + Express 4 |
| Database | SQLite via `node-sqlite3-wasm` |
| Auth | JWT (`jsonwebtoken`) |
| Passwords | `hash-wasm` (Argon2id) |
| Email | `nodemailer` |
| File uploads | `multer` |
| Security | `helmet`, `express-rate-limit` |
| Fonts | DM Sans · Syne |

---

## Project Structure

```
/client
  index.html
  /css
  /js
    api.js          # All fetch wrappers
    app.js          # Bootstrap & auth guard
    router.js       # Hash-based SPA router
    utils.js        # toast, showModal, escHtml, tagsInput, etc.
    /pages
      login.js
      register.js
      forgot-password.js
      verify-email.js
      accept-invite.js   # Pending-share invitation landing
      projects.js   # Projects list + navbar + share modal
      board.js      # Kanban board
      profile.js

/server
  server.js         # Express app + route mounts
  /middleware
    auth.js         # requireAuth + signToken
  /models
    db.js           # SQLite init & migrations
  /routes
    auth.js
    projects.js
    buckets.js
    tasks.js
    checklists.js
    risks.js
    shares.js       # Project sharing + pending invites + revoke-as-fork
    profile.js
    admin.js
    feedback.js
  /utils
    hash.js                # Argon2id + SHA-512
    email.js               # Transactional + digest + invite emails
    access.js              # canViewProject / canEditProject / isProjectOwner
    pendingShares.js       # Promotes pending invites into real shares
    reminderScheduler.js   # Daily 8am cron for reminders & digests
  /uploads          # Uploaded images (gitignored)
  /data
    orbit.db        # SQLite database (gitignored)
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- An SMTP account (e.g. Gmail app password) for email features

### 1. Clone the repo

```bash
git clone https://github.com/your-username/orbit.git
cd orbit
```

### 2. Install server dependencies

```bash
cd server
npm install
```

### 3. Configure environment variables

Create `server/.env`:

```env
PORT=3000
APP_URL=http://localhost:3000

JWT_SECRET=<long random hex string>
EMAIL_ENCRYPTION_KEY=<32-byte hex string>

SUPER_ADMIN_EMAIL=you@example.com
FEEDBACK_EMAIL=you@example.com

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your@gmail.com

# NODE_ENV=production   # Uncomment in production
```

### 4. Start the server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

The Express server serves the `client/` folder as static files. Open `http://localhost:3000` in your browser.

---

## Environment Variables Reference

| Variable | Description |
|---|---|
| `PORT` | Port the server listens on (default `3000`) |
| `APP_URL` | Public base URL — used for CORS and password-reset links |
| `JWT_SECRET` | Signs JWTs; also fallback email encryption key |
| `EMAIL_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM email encryption |
| `SUPER_ADMIN_EMAIL` | Email address granted admin role (never stored in DB) |
| `FEEDBACK_EMAIL` | Recipient for user feedback submissions |
| `SMTP_*` | Nodemailer SMTP credentials |
| `NODE_ENV` | Set to `production` to enable secure cookies & HSTS |

---

## API Overview

| Resource | Base path |
|---|---|
| Auth | `/api/auth` |
| Projects | `/api/projects` |
| Buckets | `/api/projects/:id/buckets` · `/api/buckets/:id` |
| Tasks | `/api/buckets/:id/tasks` · `/api/tasks/:id` |
| Checklists | `/api/tasks/:id/checklists` |
| Risks | `/api/projects/:id/risks` · `/api/risks/:id` |
| Shares | `/api/projects/:id/shares` · `/api/auth/invite/:token` · `/api/auth/register-with-invite/:token` |
| Profile | `/api/profile` |
| Admin | `/api/admin` |

All endpoints (except `/api/auth/*`) require a valid JWT cookie.

---

## Security Notes

- Passwords are hashed with **Argon2id** — never plain SHA-512
- Emails are stored **AES-256-GCM encrypted** at rest; a SHA-512 hash is used for constant-time lookups
- File uploads are validated by MIME type + extension; filenames are replaced with random UUIDs
- All user-supplied text is stripped of HTML tags server-side before any DB write
- Admin role is resolved at runtime from `SUPER_ADMIN_EMAIL` — it is never stored in the database

---

## License

MIT — see [LICENSE](LICENSE) for details.
