const crypto = require('crypto');
const { argon2id, argon2Verify } = require('hash-wasm');

function sha512(text) {
  return crypto.createHash('sha512').update(text).digest('hex');
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

function getEmailKey() {
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
    return stored;
  }
}

module.exports = { sha512, hashPassword, verifyPassword, encryptEmail, decryptEmail };
