# Orbit

A personal project management web app inspired by Trello and Microsoft Planner. Organize work into projects, break them into kanban-style buckets, and track tasks and risks — complete with RPN scoring, file attachments, bucket colors, and dark mode.

---

## Features

- **Projects** — create and manage projects with cover images and tags; edit from the board header
- **Kanban boards** — unlimited buckets per project with custom header colors and inline storyboard notes
- **Tasks** — priority levels, due dates, picture attachments, and tags
- **Risk management** — severity / probability / detectability scoring with automatic RPN calculation, solution tracking, and status (Open / Resolved)
- **Authentication** — JWT-based login, registration, forgot/reset password via email (SMTP)
- **Profile** — display name, avatar upload, password change, dark / light mode toggle, delete account
- **Security** — argon2id password hashing, rate limiting on auth endpoints, file type restrictions (jpg/png only)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS (ES modules), SPA with hash-based routing |
| Backend | Node.js + Express |
| Database | SQLite via `node-sqlite3-wasm` (no native compilation required) |
| Auth | JSON Web Tokens (7-day expiry) |
| Password hashing | argon2id via `hash-wasm` (WASM, no native build needed) |
| File uploads | Multer (jpg/png/jpeg only, 5 MB limit) |
| Email | Nodemailer via SMTP (console fallback if not configured) |
| Config | `dotenv` — environment variables from `server/.env` |

---

## Project Structure

```
Orbit/
├── client/                  # Frontend SPA (served as static files)
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── app.js
│       ├── api.js
│       ├── router.js
│       ├── utils.js
│       └── pages/
│           ├── login.js
│           ├── register.js
│           ├── forgot-password.js
│           ├── projects.js
│           ├── board.js
│           └── profile.js
└── server/                  # REST API
    ├── server.js
    ├── .env                 # Local config (not committed)
    ├── models/
    ├── routes/
    ├── middleware/
    ├── utils/
    ├── uploads/             # Uploaded images (auto-created)
    └── data/                # SQLite database file (auto-created)
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
JWT_SECRET=your-secret-here

# Email (SMTP) — required for forgot-password emails
# Gmail: use an App Password from https://myaccount.google.com/apppasswords
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your@gmail.com
```

> Without SMTP configured, password reset links are printed to the server console instead of being emailed.

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

## Security

| Area | Implementation |
|------|---------------|
| Passwords | argon2id with random salt (64 MB memory, 3 iterations) |
| Tokens | JWT signed with `JWT_SECRET` from environment |
| Auth rate limiting | 20 req / 15 min on all auth routes; 5 req / hour on forgot-password |
| File uploads | MIME type + extension whitelist (jpg, jpeg, png); 5 MB max |
| Password policy | Min 8 characters, uppercase, number, and special character required |

---

## API Overview

| Resource | Endpoints |
|----------|-----------|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password/:token` |
| Profile | `PUT /api/profile`, `DELETE /api/profile` |
| Projects | `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id` |
| Buckets | `GET/POST /api/projects/:id/buckets`, `PUT/DELETE /api/buckets/:id` |
| Tasks | `GET/POST /api/buckets/:id/tasks`, `PUT/DELETE /api/tasks/:id` |
| Risks | `GET/POST /api/buckets/:id/risks`, `PUT/DELETE /api/risks/:id` |

---

## License

MIT
