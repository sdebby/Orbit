const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// node-sqlite3-wasm WASM VFS: needs a path relative to process.cwd(), uses
// a directory-based lock file. Clean up any stale lock on startup.
const dbRelPath = path.relative(process.cwd(), path.join(dataDir, 'orbit.db')).replace(/\\/g, '/');
const lockPath = path.join(dataDir, 'orbit.db.lock');
if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { recursive: true, force: true });

const _db = new Database(dbRelPath);

// WAL mode is incompatible with node-sqlite3-wasm WASM VFS; use DELETE (default)
_db.exec('PRAGMA foreign_keys = ON');

_db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    email_hash TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    profile_picture TEXT,
    reset_token TEXT,
    reset_token_expires INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    picture TEXT,
    tags TEXT DEFAULT '[]',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS buckets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    picture TEXT,
    position INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    picture TEXT,
    priority TEXT DEFAULT 'Medium',
    due_date TEXT,
    tags TEXT DEFAULT '[]',
    position INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (bucket_id) REFERENCES buckets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS risks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    photos TEXT DEFAULT '[]',
    severity INTEGER DEFAULT 5,
    probability INTEGER DEFAULT 5,
    detectability INTEGER DEFAULT 5,
    solution_description TEXT,
    solution_photos TEXT DEFAULT '[]',
    status TEXT DEFAULT 'Open',
    tags TEXT DEFAULT '[]',
    position INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (bucket_id) REFERENCES buckets(id) ON DELETE CASCADE
  );
`);

// Migrations — ADD COLUMN is idempotent via try/catch (SQLite has no IF NOT EXISTS for columns)
try { _db.exec('ALTER TABLE buckets ADD COLUMN color TEXT'); } catch {}
try { _db.exec('ALTER TABLE users ADD COLUMN username TEXT'); } catch {}
try { _db.exec('ALTER TABLE tasks ADD COLUMN completed_at INTEGER'); } catch {}

// node-sqlite3-wasm requires params as an array, unlike better-sqlite3 which uses spread.
// This wrapper normalises the API so routes work with spread args.
class Statement {
  constructor(stmt) { this._s = stmt; }
  all(...args)  { return this._s.all(args.length === 1 && Array.isArray(args[0]) ? args[0] : args); }
  get(...args)  { return this._s.get(args.length === 1 && Array.isArray(args[0]) ? args[0] : args); }
  run(...args)  { return this._s.run(args.length === 1 && Array.isArray(args[0]) ? args[0] : args); }
}

const db = {
  prepare: (sql) => new Statement(_db.prepare(sql)),
  exec:    (sql) => { _db.exec(sql); return db; },
};

module.exports = db;
