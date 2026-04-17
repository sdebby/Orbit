// Full dump-and-rebuild repair script for corrupted orbit.db
// 1. Stop the server
// 2. cd server
// 3. node repair-db.js
// 4. Restart the server
// Delete this file when done.

require('dotenv').config();
const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'orbit.db');
const backupPath = path.join(dataDir, `orbit-corrupt-${Date.now()}.db`);
const newDbPath = path.join(dataDir, 'orbit-new.db');

if (!fs.existsSync(dbPath)) { console.error('No DB at', dbPath); process.exit(1); }

// Clean locks
for (const f of [dbPath + '.lock', newDbPath + '.lock'])
  if (fs.existsSync(f)) fs.rmSync(f, { recursive: true, force: true });

// Open old DB
const oldRel = path.relative(process.cwd(), dbPath).replace(/\\/g, '/');
const oldDb = new Database(oldRel);

// Tables to dump — order matters (parents before children)
const tables = [
  'users', 'projects', 'buckets', 'tasks',
  'task_checklists', 'bucket_templates', 'risks'
];

// 1. Dump all data
console.log('Dumping data from old database…');
const dump = {};
for (const t of tables) {
  try {
    dump[t] = oldDb.prepare(`SELECT * FROM ${t}`).all([]);
    console.log(`  ${t}: ${dump[t].length} rows`);
  } catch (e) {
    console.error(`  ${t}: FAILED (${e.message}) — will be empty`);
    dump[t] = [];
  }
}

// Close old DB (node-sqlite3-wasm has no .close(), so we just stop using it)
// Move old file aside
fs.copyFileSync(dbPath, backupPath);
console.log('\nCorrupt DB backed up to', path.basename(backupPath));

// Remove old db and lock
fs.unlinkSync(dbPath);
if (fs.existsSync(dbPath + '.lock')) fs.rmSync(dbPath + '.lock', { recursive: true, force: true });

// 2. Create fresh DB with full schema (matching db.js)
console.log('\nCreating fresh database…');
const freshRel = path.relative(process.cwd(), dbPath).replace(/\\/g, '/');
const freshDb = new Database(freshRel);

freshDb.exec('PRAGMA foreign_keys = OFF'); // OFF during import to avoid cascade issues

freshDb.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    email_hash TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    profile_picture TEXT,
    reset_token TEXT,
    reset_token_expires INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    username TEXT,
    email_verified INTEGER DEFAULT 0,
    verify_token TEXT,
    verify_token_expires INTEGER,
    token_version INTEGER DEFAULT 0,
    last_active INTEGER,
    status TEXT DEFAULT 'active',
    reminder_interval INTEGER DEFAULT 0,
    reminder_last_sent TEXT
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    picture TEXT,
    tags TEXT DEFAULT '[]',
    created_at INTEGER DEFAULT (unixepoch()),
    favorite INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE buckets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    picture TEXT,
    position INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    color TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    picture TEXT,
    priority TEXT DEFAULT 'Medium',
    due_date TEXT,
    tags TEXT DEFAULT '[]',
    position INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    completed_at INTEGER,
    reminder INTEGER DEFAULT 0,
    FOREIGN KEY (bucket_id) REFERENCES buckets(id) ON DELETE CASCADE
  );

  CREATE TABLE task_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    checked INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE bucket_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    bucket_data TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE risks (
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
`);

// 3. Re-import data
console.log('Importing data…');

function insertRows(db, table, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => '?').join(',');
  const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
  for (const row of rows) {
    try {
      stmt.run(cols.map(c => row[c] !== undefined ? row[c] : null));
    } catch (e) {
      console.error(`  Skipping row in ${table}: ${e.message}`);
    }
  }
  console.log(`  ${table}: ${rows.length} rows imported`);
}

for (const t of tables) {
  insertRows(freshDb, t, dump[t]);
}

// Turn FK back on and verify
freshDb.exec('PRAGMA foreign_keys = ON');

console.log('\nRunning integrity check…');
const check = freshDb.prepare('PRAGMA integrity_check').all([]);
console.log('Integrity:', check.map(r => r.integrity_check).join(', '));

console.log('\nDone! Restart the server.');
