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

  CREATE TABLE IF NOT EXISTS task_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    checked INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bucket_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    bucket_data TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
try { _db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0'); } catch {}
try { _db.exec('ALTER TABLE users ADD COLUMN verify_token TEXT'); } catch {}
try { _db.exec('ALTER TABLE users ADD COLUMN verify_token_expires INTEGER'); } catch {}
// Mark existing accounts (created before verification was introduced) as already verified
try { _db.exec("UPDATE users SET email_verified = 1 WHERE email_verified IS NULL OR (verify_token IS NULL AND email_verified = 0)"); } catch {}

// Encrypt existing plaintext emails at rest, and re-encrypt with current key
try {
  const { encryptEmail, decryptEmail } = require('../utils/hash');
  const allUsers = _db.prepare('SELECT id, email FROM users').all();
  const updateStmt = _db.prepare('UPDATE users SET email = ? WHERE id = ?');
  for (const row of allUsers) {
    if (row.email && row.email.includes('@')) {
      // Plaintext email — encrypt it
      updateStmt.run([encryptEmail(row.email), row.id]);
    } else if (row.email && process.env.EMAIL_ENCRYPTION_KEY) {
      // Already encrypted — re-encrypt with current (dedicated) key
      const plain = decryptEmail(row.email);
      if (plain && plain.includes('@')) {
        const freshEnc = encryptEmail(plain);
        if (freshEnc !== row.email) updateStmt.run([freshEnc, row.id]);
      }
    }
  }
} catch (e) { console.error('Email encryption migration:', e.message); }

try { _db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0'); } catch {}
try { _db.exec('ALTER TABLE projects ADD COLUMN favorite INTEGER DEFAULT 0'); } catch {}
try { _db.exec('ALTER TABLE users ADD COLUMN last_active INTEGER'); } catch {}

// Migrate risks from bucket-level to project-level
try {
  _db.exec('SELECT bucket_id FROM risks LIMIT 0'); // throws if already migrated
  _db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE risks_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
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
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    INSERT OR IGNORE INTO risks_v2 (id, project_id, description, photos, severity, probability, detectability, solution_description, solution_photos, status, tags, position, created_at)
      SELECT r.id, b.project_id, r.description, r.photos, r.severity, r.probability, r.detectability, r.solution_description, r.solution_photos, r.status, r.tags, r.position, r.created_at
      FROM risks r JOIN buckets b ON r.bucket_id = b.id;
    DROP TABLE risks;
    ALTER TABLE risks_v2 RENAME TO risks;
    PRAGMA foreign_keys = ON;
  `);
} catch {}

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
