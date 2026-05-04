const crypto = require('crypto');
const { argon2id, argon2Verify } = require('hash-wasm');

function sha512(text) {
  return crypto.createHash('sha512').update(text).digest('hex');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return argon2id({
    password,
    salt,
    iterations: 3,
    parallelism: 1,
    memorySize: 65536, // 64 MB
    hashLength: 32,
    outputType: 'encoded', // PHC string — salt embedded
  });
}

async function verifyPassword(password, hash) {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

// --- Email encryption at rest (AES-256-GCM) ---

const UPLOAD_PATH_RE = /^\/uploads\/[\w\-\.]+$/;

function safePicturePath(p) {
  if (!p) return null;
  return UPLOAD_PATH_RE.test(p) ? p : null;
}

function getEmailKey() {
  // Prefer dedicated key; fall back to old derivation for backward compat
  const dedicated = process.env.EMAIL_ENCRYPTION_KEY;
  if (dedicated) return Buffer.from(dedicated, 'hex');
  const secret = process.env.JWT_SECRET || '';
  return crypto.createHash('sha256').update('email-encryption:' + secret).digest();
}

function getLegacyEmailKey() {
  const secret = process.env.JWT_SECRET || '';
  return crypto.createHash('sha256').update('email-encryption:' + secret).digest();
}

function encryptEmail(email) {
  const key = getEmailKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(email, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + enc;
}

function decryptEmail(stored) {
  if (!stored) return stored;
  if (stored.includes('@')) return stored; // legacy plaintext
  try {
    const [ivHex, tagHex, data] = stored.split(':');
    const key = getEmailKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let dec = decipher.update(data, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    // Fall back to legacy key if dedicated key fails (migration transition)
    try {
      const [ivHex, tagHex, data] = stored.split(':');
      const key = getLegacyEmailKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      let dec = decipher.update(data, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    } catch {
      return stored;
    }
  }
}

module.exports = { sha256, sha512, hashPassword, verifyPassword, encryptEmail, decryptEmail, safePicturePath };
