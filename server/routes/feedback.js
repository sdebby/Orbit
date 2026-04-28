const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const { decryptEmail } = require('../utils/hash');
const { sendFeedbackEmail } = require('../utils/email');

// POST /api/feedback
router.post('/', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });
  if (message.length > 5000) return res.status(400).json({ error: 'Message must be 5000 characters or fewer' });

  const adminEmail = process.env.FEEDBACK_EMAIL;
  if (!adminEmail) return res.status(500).json({ error: 'Feedback is not configured' });

  const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const userEmail = decryptEmail(user.email);

  try {
    await sendFeedbackEmail(adminEmail, { username: user.username, userEmail, message: message.trim() });
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to send feedback email:', err);
    res.status(500).json({ error: 'Failed to send feedback' });
  }
});

module.exports = router;
