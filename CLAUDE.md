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

### Admin — `/api/admin`
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/stats` | totalUsers, onlineNow, registeredToday, registeredLast7Days |
| GET | `/api/admin/users` | Paginated user list; supports `?q=` search |
| GET | `/api/admin/users/:id` | Single user detail + projectCount, taskCount, riskCount |
| DELETE | `/api/admin/users/:id` | Cannot delete own account |
| POST | `/api/admin/users/bulk-delete` | Body: `{ ids: number[] }` |
| POST | `/api/admin/users/:id/reset-password` | Sends password reset email |

### Profile
| Method | Path | Notes |
|---|---|---|
| PUT | `/api/profile` | username, profile_picture, password change |
| DELETE | `/api/profile` | Permanently deletes account + all data |

---

## Key Features

### Board Page
- Vertical kanban columns (buckets) containing tasks
- Each bucket has a **storyboard textarea** (editable inline, saved on blur); shows a ✏ pencil icon on hover and a "Saved ✓" indicator after a successful save
- Each bucket has an optional **color** applied to the column header
- **Task completion**: checkbox marks task done with timestamp; done tasks move to a collapsible "✓ N Done" section at the bottom of each column. The summary shows a ▶ chevron (via CSS `::before`) that rotates 90° when open. The completed task circle is filled green; hovering turns it red to signal "click to undo".
- **Project-level Risks column**: always shown as a dedicated board column, even when empty (shows an empty-state message); positioned at the end of the scroll by default, draggable to any position
- `+ Add Bucket` renders as a full-width (280px) dashed board column at the far right — never a narrow or stacked button
- **Search**: filters tasks and risks by description or tag in real-time
- **Board banner**: project picture is shown as a banner strip on the board header only — not as a full-page background. The board canvas always uses a solid colour for readability. A dark gradient overlay (`::before`) ensures header text remains legible over any image.

### Task Cards
- **Thumbnail**: if a task has a picture, it is shown as a `.card-thumb` strip at the very top of the card (100px tall, full bleed via negative margins, rounded top corners) — never as an inline image inside the content area.
- **Due date**: always shown on the card if set, using `dueDateClass()` from `utils.js` for color-coding: default grey pill (future), `.due-soon` amber pill (≤2 days), `.overdue` red pill (past). On completed tasks, the urgency class is suppressed (shown grey).
- **Priority and badge style**: priority badge (`.priority.Low/Medium/High`) and checklist progress badge (`.checklist-progress`) use the same pill style — `font-size: 11px`, `padding: 2px 6px`, `border-radius: 4px`, with a background fill.
- **Inline checklists**: tasks with checklist items show a `<details class="card-checklist-section">` collapsible inside the card. The `<summary>` is the progress badge (e.g. "2/3"). The body contains `.card-cl-active` (red-tinted) for pending items and a nested `<details class="card-cl-done-section">` (green-tinted, **collapsed by default** with ▶ chevron) for done items. Checklists are pre-loaded in `loadAll()` and mounted via `mountCardChecklists(card, task)`. Toggling an item calls `api.updateChecklist` and re-renders in-place — no full board reload. The summary click has `stopPropagation` to prevent the task modal from opening.

### Projects Page
- Card grid of all user projects
- Search by keyword; filter by tags
- Edit / delete revealed via hover `⋮` menu on each card — never always-visible buttons
- Favorite toggle shows a toast confirmation

### Admin Panel
- **Stat cards** are non-interactive display widgets — no hover/active styling, no cursor pointer. Never add an `accent` border to a stat card unless click-to-filter is implemented.
- **Current-user row**: the Actions cell shows `🔒 Your account` (`.admin-self-lock`) instead of a blank cell to explain why actions are absent.
- **User detail drawer**: clicking any table row (except on checkboxes, buttons, or `.admin-cb-col`) slides in a 340px right-side drawer (`.admin-drawer`) over a backdrop. The drawer shows the user's avatar, name, email, registration date, last active, verified status, and async-loaded project/task/risk counts from `GET /api/admin/users/:id`. Non-self users get Reset Email + Delete buttons inside the drawer. Self gets a lock note. Closes on `×`, backdrop click, or Escape.

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

## UI/UX Guidelines

### Global Chrome
- **Navbar** is rendered by `navbarHtml()` in `projects.js` and used on every authenticated page. Do not create separate navbars.
- **Orbit logo** (`navbar-brand`) is always a clickable `<a href="#/projects">` — never a `<span>`.
- **User menu**: avatar button (`#nav-avatar-btn`) opens a `.user-dropdown` with Profile, Admin (if `user.isAdmin`), and Sign out. The standalone Sign out button does not appear outside the dropdown.
- **Breadcrumb**: use `breadcrumbHtml(label?)` from `projects.js` for "← Projects" back navigation. Never use a bare `<button>` with an onclick for this purpose.
- `setupNavbar()` must be called once per page render to wire all navbar interactions.

### Modal Conventions
- **`showModal(html)`** auto-focuses the first focusable field (`input`, `textarea`, `select` — excluding `type=hidden` and `type=file`) via `requestAnimationFrame`. Do not manually call `.focus()` after `showModal`.
- **Titles**: `New [X]` for creation, `Edit [X]` for editing.
- **CTA buttons**: `Create [X]` for new entities (Create Task, Create Risk, Create Bucket, Create Project); `Save` for edits — never `Save Changes` or `Add [X]`.
- **Destructive actions** (e.g. Delete Bucket) belong exclusively in the context menu (⋮ dropdown), never inside an edit modal.
- **Image/attachment fields** use the label `Image` everywhere — never `Photo`, `Picture`, or `Background Picture`.

### Interaction Patterns
- **One entry point per concept**: each action (add task, add risk, add bucket) has exactly one trigger in the UI. Do not add shortcuts or duplicate buttons.
- **Add-to-column buttons** use `.bucket-add-btn` at the bottom of each column — full-width, dashed border. The risk variant uses `.bucket-add-btn.add-risk` (red, via CSS class — never inline `style=`).
- **Column add placeholder**: `+ Add Bucket` is a `.add-col` / `.add-col-btn` element — same 280px width as a bucket column, dashed border, at the far right of the board scroll.
- **Destructive / edit actions on cards** are revealed on hover, not always visible. Use a `⋮` (`&#8942;`) button that opens a `.dropdown` menu, consistent with the bucket menu pattern (`showBucketMenu`).
- **Dropdowns**: create with `document.createElement('div')`, class `dropdown`; items use `dropdown-item`; danger items add class `danger`. Dismiss on outside click: `setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0)`.
- **Inline-edit feedback**: after a blur-to-save succeeds, briefly show a "Saved ✓" indicator via a CSS class toggle (`.just-saved`) rather than a toast — reserve toasts for modal-level mutations. Pencil icons (✏) on hover signal editability without permanently consuming space.

### Empty States
- Board columns with no items show a `.col-empty-state` div with brief instructional text (e.g. "No risks yet. Click **+ Risk** to track one.").
- The Risks column is always rendered, regardless of whether risks exist — the empty state is the signal, not the column's absence.
- Projects grid uses `.empty-state` when no projects exist.

### Toast Notifications
- All user-initiated mutations (create, update, delete, toggle) must show a `toast(msg, type)` confirmation.
- Types: `'success'`, `'error'`, `'info'`.
- Favorite toggle: `'⭐ Marked as favorite'` / `'Removed from favorites'` (`'info'` type).
- Use the API response to determine the new state before composing the message.

### CSS Conventions
- Never use inline `style=` for theme colours or brand colours — always use a CSS class.
- Dark mode is controlled by `body[data-theme="dark"]`; use CSS custom properties (`--text`, `--bg`, `--bg2`, `--border`, `--red`, `--blue`, etc.) for all colours.
- Interactive state changes (hover, focus) are handled in CSS via `transition`, not JavaScript.
- Scoped styles: user-menu dropdown items use `.user-dropdown .dropdown-item` to avoid overriding the admin panel's `.dropdown-item` rules.
- Back-link (`<a class="back-link">`) requires `text-decoration: none` when rendered as an `<a>` tag.
- Hover-reveal elements (pencil icons, card menus) use `opacity: 0` by default and `opacity: 1` on the parent's `:hover` — never `display: none` (avoids layout shift).
- Use `:focus-within` on a parent to suppress hover affordances while a child has focus (e.g. hide the pencil icon while the storyboard textarea is active).
- Board banner image is set via JS on the `.board-header` element only; `has-bg` on the container scopes the CSS overrides. Never set `backgroundImage` on `.board-container` itself.

### Component Locations
| Component | Location |
|---|---|
| `navbarHtml()` | `client/js/pages/projects.js` |
| `setupNavbar()` | `client/js/pages/projects.js` |
| `breadcrumbHtml(label?)` | `client/js/pages/projects.js` |
| `showProjectMenu(btn, id)` | `client/js/pages/projects.js` |
| `showBucketMenu(btn, bucket)` | `client/js/pages/board.js` |
| `showBucketModal(bucket?)` | `client/js/pages/board.js` |
| `showTaskModal(bucketId, task?)` | `client/js/pages/board.js` |
| `showRiskModal(risk?)` | `client/js/pages/board.js` |
| `mountCardChecklists(card, task)` | `client/js/pages/board.js` |
| `toast(msg, type)` | `client/js/utils.js` |
| `showModal(html)` / `hideModal()` | `client/js/utils.js` |
| `escHtml(str)` | `client/js/utils.js` |
| `formatDate(dateStr)` | `client/js/utils.js` |
| `dueDateClass(dateStr)` | `client/js/utils.js` — returns `'overdue'`, `'due-soon'`, or `''` |
| `isOverdue(dateStr)` | `client/js/utils.js` |

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
