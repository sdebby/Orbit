const crypto = require('crypto');

function sha512(text) {
  return crypto.createHash('sha512').update(text).digest('hex');
}

module.exports = { sha512 };
