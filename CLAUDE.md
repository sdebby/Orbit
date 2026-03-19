# CLAUDE.md — Project Orbit

## Project Overview

**Project Orbit** is a personalized project management web app inspired by Trello and Microsoft Planner, with tailored features for task tracking and risk management. It includes a vanilla-JS SPA frontend and a Node.js/Express REST API backend with a SQLite database.

---

## Architecture

- **Frontend**: Vanilla JS SPA (`client/`) — hash-based routing, no framework
- **Backend**: Express REST API (`server/`) — CommonJS modules, JWT auth
- **Database**: SQLite via `node-sqlite3-wasm` (WASM VFS, no WAL mode)
- **File uploads**: Multer → `server/uploads/` (served as static files)

---

## Folder Structure

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
      projects.js   # Projects list + navbarHtml/setupNavbar
      board.js      # Kanban board
      profile.js

/server
  server.js         # Express app, middleware, route mounts
  /middleware
    auth.js         # requireAuth + signToken (JWT)
  /models
    db.js           # SQLite init, migrations, Statement wrapper
  /routes
    auth.js         # register, login, forgot-password, reset-password, me
    projects.js
    buckets.js
    tasks.js
    risks.js
    profile.js
  /utils
    hash.js         # hashPassword (Argon2id), verifyPassword, sha512
    email.js        # sendPasswordResetEmail (nodemailer)
  /uploads          # Uploaded images (gitignored)
  /data
    orbit.db        # SQLite database (gitignored)
  .env              # Secrets — gitignored, never commit
```

---

## Domain Models

### User
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `email` | TEXT UNIQUE | Stored normalized (lowercase) |
| `email_hash` | TEXT UNIQUE | SHA-512 of normalized email — used for lookup |
| `password_hash` | TEXT | **Argon2id** — never SHA-512 |
| `username` | TEXT | Optional display name |
| `profile_picture` | TEXT | `/uploads/…` path |
| `reset_token` | TEXT | |
| `reset_token_expires` | INTEGER | Unix ms |
| `created_at` | INTEGER | Unix epoch (server-set) |

### Project
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK | → users |
| `title` | TEXT | Required |
| `description` | TEXT | |
| `picture` | TEXT | `/uploads/…` path |
| `tags` | TEXT | JSON array of strings |
| `created_at` | INTEGER | Unix epoch (server-set) |

### Bucket
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER FK | → projects |
| `title` | TEXT | Required |
| `description` | TEXT | Used as storyboard text |
| `color` | TEXT | Hex color for column header |
| `position` | INTEGER | Display order |
| `created_at` | INTEGER | Unix epoch (server-set) |

### Task
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `bucket_id` | INTEGER FK | → buckets |
| `description` | TEXT | Required |
| `picture` | TEXT | `/uploads/…` path |
| `priority` | TEXT | `Low` / `Medium` / `High` (default Medium) |
| `due_date` | TEXT | `YYYY-MM-DD` |
| `tags` | TEXT | JSON array of strings |
| `position` | INTEGER | Display order within bucket |
| `completed_at` | INTEGER | Unix epoch when marked done; NULL if open |
| `created_at` | INTEGER | Unix epoch (server-set) |

### Risk
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER FK | → projects (**not** bucket-level) |
| `description` | TEXT | Required |
| `photos` | TEXT | JSON array of `/uploads/…` paths |
| `severity` | INTEGER | 1–10 (default 5) |
| `probability` | INTEGER | 1–10 (default 5) |
| `detectability` | INTEGER | 1–10 (default 5) |
| `rpn` | — | **Computed**: severity × probability × detectability (never stored) |
| `solution_description` | TEXT | |
| `solution_photos` | TEXT | JSON array of `/uploads/…` paths |
| `status` | TEXT | `Open` / `Resolved` (default Open) |
| `tags` | TEXT | JSON array of strings |
| `position` | INTEGER | Display order |
| `created_at` | INTEGER | Unix epoch (server-set) |

---

## API Routes

### Auth — `/api/auth`
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | Rate-limited (20/15 min) |
| POST | `/api/auth/login` | Rate-limited (20/15 min) |
| POST | `/api/auth/forgot-password` | Rate-limited (5/1 hr); constant-time response |
| POST | `/api/auth/reset-password/:token` | Token expires after 1 hour |
| GET  | `/api/auth/me` | Returns current user from JWT |

### Projects — `/api/projects`
| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects` | Supports `?q=` and `?tags=` |
| POST | `/api/projects` | Accepts `multipart/form-data` (picture) |
| GET | `/api/projects/:id` | |
| PUT | `/api/projects/:id` | Accepts `multipart/form-data`; `remove_picture=true` removes image |
| DELETE | `/api/projects/:id` | Cascades to buckets → tasks |

### Buckets
| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects/:projectId/buckets` | |
| POST | `/api/projects/:projectId/buckets` | |
| PUT | `/api/buckets/:id` | |
| DELETE | `/api/buckets/:id` | Cascades to tasks |

### Tasks
| Method | Path | Notes |
|---|---|---|
| GET | `/api/buckets/:bucketId/tasks` | |
| POST | `/api/buckets/:bucketId/tasks` | Accepts `multipart/form-data` |
| GET | `/api/tasks/:id` | |
| PUT | `/api/tasks/:id` | `completed: true/false` sets/clears `completed_at` |
| DELETE | `/api/tasks/:id` | |

### Risks
| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects/:projectId/risks` | |
| POST | `/api/projects/:projectId/risks` | Accepts `multipart/form-data` |
| GET | `/api/risks/:id` | |
| PUT | `/api/risks/:id` | |
| DELETE | `/api/risks/:id` | |

### Profile
| Method | Path | Notes |
|---|---|---|
| PUT | `/api/profile` | username, profile_picture, password change |
| DELETE | `/api/profile` | Permanently deletes account + all data |

---

## Key Features

### Board Page
- Vertical kanban columns (buckets) containing tasks
- Each bucket has a **storyboard textarea** (editable inline, saved on blur)
- Each bucket has an optional **color** applied to the column header
- **Task completion**: checkbox marks task done with timestamp; done tasks move to a collapsible "✓ N Done" section at the bottom of each column
- **Project-level Risks column**: single column at the end of the board; only shown if risks exist
- **Search**: filters tasks and risks by description or tag in real-time
- Board background: project picture displayed as dimmed board background

### Projects Page
- Card grid of all user projects
- Search by keyword; filter by tags
- Create / edit / delete projects with picture, description, and tags

### Profile Page
- Upload/change avatar (jpg/jpeg/png, max 2 MB)
- Set/update display username
- Change password (requires current password)
- Toggle dark mode (persisted in localStorage)
- Delete account permanently

### Auth Pages
- Register with email + password (complexity enforced)
- Login, logout
- Forgot password → email reset link → reset password page

---

## Authentication & Security

- **JWT** in `localStorage` (`orbit_token`); 7-day expiry; Bearer header on all API calls
- **Passwords**: Argon2id via `server/utils/hash.js` — **never SHA-512**
- **Emails**: stored normalized + SHA-512 hash for constant-time lookup
- **Password complexity**: 8+ chars, uppercase, number, special character (enforced on register and password change)
- **Security headers**: `helmet` with CSP (`self`, `unsafe-inline` for styles, no inline scripts)
- **CORS**: restricted to `APP_URL` env var only
- **CSRF defense**: POST/PUT/DELETE requests with a mismatched `Origin` header are rejected with 403
- **Rate limiting**: auth 20/15 min; forgot-password 5/1 hr
- **Body size**: 10 KB limit on JSON/form payloads
- **File uploads**: MIME type + extension whitelist (jpg/jpeg/png); filenames replaced with `crypto.randomUUID()` + extension
- **Timing attack mitigation**: forgot-password always responds after a minimum 300 ms delay

---

## Coding Guidelines

- All timestamps (`created_at`, `completed_at`) are set **server-side** — never trust client-supplied timestamps
- **RPN is computed** — always derive server-side: `rpn = severity × probability × detectability`; never store it
- **Passwords**: always use Argon2id via `server/utils/hash.js` — never SHA-512
- **HTML rendering**: always use `escHtml()` before inserting user data into innerHTML
- **File URLs in CSS**: validate with `/^\/uploads\/[\w\-\.]+$/` before using in `style.backgroundImage`
- Uploaded file paths follow the pattern `/uploads/<prefix>-<uuid><.ext>`
- Tag arrays are plain string arrays (JSON); no rigid taxonomy
- SQLite migrations use idempotent `try { ALTER TABLE … } catch {}` or full table-recreate pattern
- `node-sqlite3-wasm` requires params as an array — use the `Statement` wrapper in `db.js`
- REST conventions: collection routes on the parent (`/projects/:id/buckets`), standalone CRUD on `/buckets/:id`
- Ask before introducing any new third-party libraries

---

## Environment Variables (`.env`)

```
PORT=3000
APP_URL=http://localhost:3000   # Used for CORS allowed origin and reset-link base URL
JWT_SECRET=<long random hex>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<gmail address>
SMTP_PASS=<gmail app password>
SMTP_FROM=<gmail address>
```

**Never commit `.env`** — it is in `.gitignore`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express 4 |
| Database | SQLite via `node-sqlite3-wasm` |
| Auth | `jsonwebtoken` (JWT) |
| Passwords | `hash-wasm` (Argon2id + SHA-512) |
| Email | `nodemailer` |
| File upload | `multer` |
| Security headers | `helmet` |
| Rate limiting | `express-rate-limit` |
| Config | `dotenv` |
| Dev | `nodemon` |
| Frontend | Vanilla JS (ES modules), no framework |

---

## Future Roadmap (Not Yet Implemented)

- [ ] 2-step verification
- [ ] Project sharing (viewer/commenter via link)
- [ ] User assignment to tasks
- [ ] Email reminders
- [ ] AI-based intelligence
- [ ] Calendar integration (Google / Outlook)
- [ ] Mobile app
- [ ] Drag-and-drop reordering of buckets/tasks

Do **not** build or scaffold these unless explicitly instructed.
