# Orbit

A personal project management web app inspired by Trello and Microsoft Planner. Organize work into projects, break them into kanban-style buckets, and track tasks and risks — complete with RPN scoring, file attachments, and dark mode.

---

## Features

- **Projects** — create and manage projects with cover images and tags
- **Kanban boards** — unlimited buckets per project, each with tasks and risks
- **Tasks** — priority levels, due dates, picture attachments, and tags
- **Risk management** — severity / probability / detectability scoring with automatic RPN calculation, solution tracking, and status (Open / Resolved)
- **Authentication** — JWT-based login, registration, forgot/reset password via email
- **Profile** — avatar upload, password change, dark / light mode toggle

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS (ES modules), SPA with hash-based routing |
| Backend | Node.js + Express |
| Database | SQLite via `node-sqlite3-wasm` (no native compilation required) |
| Auth | JSON Web Tokens (7-day expiry) |
| File uploads | Multer |
| Email | Nodemailer (console fallback if SMTP not configured) |

---

## Project Structure

```
Orbit/
├── client/          # Frontend SPA (served as static files)
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
└── server/          # REST API
    ├── server.js
    ├── models/
    ├── routes/
    ├── middleware/
    ├── utils/
    ├── uploads/     # Uploaded images (auto-created)
    └── data/        # SQLite database file (auto-created)
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

## Configuration (optional)

To enable real email delivery for password reset links, set the following environment variables before starting the server:

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (default: 587) |
| `SMTP_USER` | SMTP username / email |
| `SMTP_PASS` | SMTP password |
| `APP_URL` | Public URL of the app (e.g. `http://localhost:3000`) |
| `JWT_SECRET` | Secret key for signing tokens |

Without SMTP configuration, password reset links are printed to the server console instead of being emailed.

---

## API Overview

| Resource | Endpoints |
|----------|-----------|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password/:token` |
| Profile | `PUT /api/profile` |
| Projects | `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id` |
| Buckets | `GET/POST /api/projects/:id/buckets`, `PUT/DELETE /api/buckets/:id` |
| Tasks | `GET/POST /api/buckets/:id/tasks`, `PUT/DELETE /api/tasks/:id` |
| Risks | `GET/POST /api/buckets/:id/risks`, `PUT/DELETE /api/risks/:id` |

---

## License

MIT
