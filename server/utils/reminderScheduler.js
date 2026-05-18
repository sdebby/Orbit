const db = require('../models/db');
const { decryptEmail } = require('./hash');
const { sendTaskReminderEmail, sendUndueTasksDigestEmail } = require('./email');

async function sendDailyReminders() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const rows = db.prepare(`
    SELECT
      t.id        AS task_id,
      t.description AS task_description,
      t.due_date,
      b.title     AS bucket_title,
      b.description AS bucket_description,
      p.title     AS project_title,
      u.email     AS encrypted_email
    FROM tasks t
    JOIN buckets b ON t.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE t.reminder = 1
      AND t.due_date = ?
      AND t.completed_at IS NULL
      AND (u.status IS NULL OR u.status = 'active')
  `).all(today);

  for (const row of rows) {
    try {
      const email = decryptEmail(row.encrypted_email);
      if (!email || !email.includes('@')) continue;

      await sendTaskReminderEmail(email, {
        taskDescription:   row.task_description,
        bucketTitle:       row.bucket_title,
        bucketDescription: row.bucket_description,
        projectTitle:      row.project_title,
        dueDate:           row.due_date,
      });
      console.log(`[Reminder] Sent to ${email} — task #${row.task_id}`);
    } catch (err) {
      console.error(`[Reminder] Failed for task #${row.task_id}:`, err.message);
    }
  }

  // ---- User digest reminders ----
  const users = db.prepare(`
    SELECT id, email, reminder_interval, reminder_last_sent
    FROM users
    WHERE reminder_interval > 0
      AND (status IS NULL OR status = 'active')
  `).all();

  for (const user of users) {
    try {
      if (user.reminder_last_sent) {
        const daysSince = Math.floor(
          (new Date(today) - new Date(user.reminder_last_sent)) / 86400000
        );
        if (daysSince < user.reminder_interval) continue;
      }

      const tasks = db.prepare(`
        SELECT t.description AS task_description, t.due_date,
               b.title AS bucket_title, b.description AS bucket_description,
               p.title AS project_title
        FROM tasks t
        JOIN buckets b ON t.bucket_id = b.id
        JOIN projects p ON b.project_id = p.id
        WHERE p.user_id = ?
          AND t.completed_at IS NULL
          AND t.due_date IS NOT NULL
          AND t.due_date != ''
        ORDER BY t.due_date ASC
      `).all(user.id);

      if (!tasks.length) continue;

      const email = decryptEmail(user.email);
      if (!email || !email.includes('@')) continue;

      await sendUndueTasksDigestEmail(email, { tasks, interval: user.reminder_interval });
      db.prepare('UPDATE users SET reminder_last_sent = ? WHERE id = ?').run(today, user.id);
      console.log(`[Digest] Sent to ${email} — ${tasks.length} tasks`);
    } catch (err) {
      console.error(`[Digest] Failed for user #${user.id}:`, err.message);
    }
  }
}

function msUntilNext8am() {
  const now = new Date();
  const next8 = new Date(now);
  next8.setHours(8, 0, 0, 0);
  if (next8 <= now) next8.setDate(next8.getDate() + 1);
  return next8 - now;
}

function startReminderScheduler() {
  const delay = msUntilNext8am();
  console.log(`[Reminder] Scheduler armed — first run in ${Math.round(delay / 60000)} min`);

  setTimeout(() => {
    sendDailyReminders();
    setInterval(sendDailyReminders, 24 * 60 * 60 * 1000);
  }, delay);
}

module.exports = { startReminderScheduler };
