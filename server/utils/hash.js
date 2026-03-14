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

module.exports = { sha512, hashPassword, verifyPassword };
