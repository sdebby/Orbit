#!/usr/bin/env node
/**
 * One-shot email encryption migration / key-rotation script.
 *
 * Usage:
 *   node scripts/migrate-email-encryption.js            # encrypt any remaining plaintext emails
 *   node scripts/migrate-email-encryption.js --rekey    # also re-encrypt with the current EMAIL_ENCRYPTION_KEY
 *
 * Always run with the correct .env in place before executing.
 * After --rekey completes successfully, the old key is no longer needed.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { encryptEmail, decryptEmail } = require('../utils/hash');

// Open the DB directly — don't go through models/db.js to avoid running all boot migrations.
const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
const dbRelPath = path.relative(process.cwd(), path.join(dataDir, 'orbit.db')).replace(/\\/g, '/');
const lockPath  = path.join(dataDir, 'orbit.db.lock');
if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { recursive: true, force: true });

const db = new Database(dbRelPath);

const rekey = process.argv.includes('--rekey');

let encrypted = 0;
let rekeyed = 0;
let errors = 0;

const allUsers = db.prepare('SELECT id, email FROM users').all();
const updateStmt = db.prepare('UPDATE users SET email = ? WHERE id = ?');

for (const row of allUsers) {
  try {
    if (row.email && row.email.includes('@')) {
      // Still plaintext — encrypt now
      updateStmt.run([encryptEmail(row.email), row.id]);
      encrypted++;
    } else if (rekey && row.email) {
      // Already encrypted — decrypt with whatever key works, re-encrypt with current key
      const plain = decryptEmail(row.email);
      if (plain && plain.includes('@')) {
        const freshEnc = encryptEmail(plain);
        if (freshEnc !== row.email) {
          updateStmt.run([freshEnc, row.id]);
          rekeyed++;
        }
      } else {
        console.error(`  user #${row.id}: could not decrypt — skipped`);
        errors++;
      }
    }
  } catch (e) {
    console.error(`  user #${row.id}: ${e.message}`);
    errors++;
  }
}

db.close();

console.log(`\nEmail encryption migration complete`);
console.log(`  Plaintext emails encrypted : ${encrypted}`);
if (rekey) console.log(`  Emails re-keyed            : ${rekeyed}`);
if (errors) console.log(`  Errors (skipped)           : ${errors}`);
if (errors) process.exit(1);
