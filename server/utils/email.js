const nodemailer = require('nodemailer');

// Configure SMTP in .env — defaults to console logging when not set
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

function maskEmail(email) {
  const at = String(email).indexOf('@');
  return at > 0 ? `***${email.slice(at)}` : '***';
}

async function sendPasswordResetEmail(toEmail, resetLink) {
  const subject = 'Orbit — Password Reset';
  const html = `
    <p>You requested a password reset for your Orbit account.</p>
    <p><a href="${resetLink}">Click here to reset your password</a></p>
    <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
  `;

  if (!transporter) {
    console.log(`[EMAIL] No SMTP configured — password reset link generated for ${maskEmail(toEmail)}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@orbit.app',
    to: toEmail,
    subject,
    html,
  });
}

async function sendVerificationEmail(toEmail, verifyLink) {
  const subject = 'Orbit — Verify your email address';
  const html = `
    <p>Welcome to Orbit! Please verify your email address to activate your account.</p>
    <p><a href="${verifyLink}">Click here to verify your email</a></p>
    <p>This link expires in 30 minutes. If you did not create an account, ignore this email.</p>
  `;

  if (!transporter) {
    console.log(`[EMAIL] No SMTP configured — verification link generated for ${maskEmail(toEmail)}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@orbit.app',
    to: toEmail,
    subject,
    html,
  });
}

async function sendUndueTasksDigestEmail(toEmail, { tasks, interval }) {
  const intervalLabel = interval === 1 ? 'daily' : `every ${interval} days`;
  const subject = `Orbit — Your pending tasks (${tasks.length} task${tasks.length !== 1 ? 's' : ''})`;

  // Group by project
  const byProject = {};
  for (const t of tasks) {
    if (!byProject[t.project_title]) byProject[t.project_title] = [];
    byProject[t.project_title].push(t);
  }

  let projectsHtml = '';
  for (const [projectTitle, ptasks] of Object.entries(byProject)) {
    let rowsHtml = '';
    for (const t of ptasks) {
      const isOverdue = t.due_date < new Date().toISOString().slice(0, 10);
      const dueParts = t.due_date.split('-');
      const formattedDate = `${dueParts[2]}/${dueParts[1]}/${dueParts[0]}`;
      const dueBadge = isOverdue
        ? `<span style="color:#dc2626;font-weight:600">${escapeHtml(formattedDate)} — overdue</span>`
        : `<span style="color:#374151">${escapeHtml(formattedDate)}</span>`;
      const bucketDesc = t.bucket_description
        ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${escapeHtml(t.bucket_description)}</div>`
        : '';
      rowsHtml += `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
            <div style="font-weight:600;color:#111827">${escapeHtml(t.bucket_title)}</div>
            ${bucketDesc}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;color:#1f2937">
            ${escapeHtml(t.task_description)}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;white-space:nowrap">
            ${dueBadge}
          </td>
        </tr>`;
    }
    projectsHtml += `
      <div style="margin-bottom:24px">
        <h3 style="margin:0 0 8px;font-size:15px;color:#1a56db;border-bottom:2px solid #e5e7eb;padding-bottom:6px">
          ${escapeHtml(projectTitle)}
        </h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb;width:30%">Column</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb">Task</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb;width:130px">Due Date</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#333">
      <h2 style="color:#1a56db;border-bottom:2px solid #e5e7eb;padding-bottom:12px">
        Pending Tasks Reminder
      </h2>
      <p style="color:#4b5563">
        Here is your ${intervalLabel} summary of open tasks with due dates.
        You have <strong>${tasks.length} pending task${tasks.length !== 1 ? 's' : ''}</strong> across your projects.
      </p>
      ${projectsHtml}
      <p style="color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:24px">
        You are receiving this because you enabled task digest reminders in your Orbit profile.<br>
        To change the frequency or disable reminders, go to your Profile → Notifications settings.
      </p>
    </div>
  `;

  if (!transporter) {
    console.log(`[EMAIL] No SMTP configured — digest for ${maskEmail(toEmail)} (${tasks.length} tasks)`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@orbit.app',
    to: toEmail,
    subject,
    html,
  });
}

async function sendTaskReminderEmail(toEmail, { taskDescription, bucketTitle, bucketDescription, projectTitle, dueDate }) {
  const subject = `Orbit — Task Reminder: ${taskDescription}`;
  const bucketDetail = bucketDescription
    ? `<p style="margin:0 0 8px"><strong>Column description:</strong> ${bucketDescription}</p>`
    : '';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
      <h2 style="color:#1a56db;border-bottom:2px solid #e5e7eb;padding-bottom:12px">Task Reminder</h2>
      <p>This is a friendly reminder that the following task is due today.</p>
      <div style="background:#f9fafb;border-left:4px solid #1a56db;padding:16px;border-radius:4px;margin:16px 0">
        <p style="margin:0 0 8px"><strong>Project:</strong> ${escapeHtml(projectTitle)}</p>
        <p style="margin:0 0 8px"><strong>Column:</strong> ${escapeHtml(bucketTitle)}</p>
        ${bucketDetail}
        <p style="margin:0 0 8px"><strong>Task:</strong> ${escapeHtml(taskDescription)}</p>
        <p style="margin:0"><strong>Due date:</strong> ${escapeHtml(dueDate)}</p>
      </div>
      <p>Please review this task and take any necessary action to ensure it is completed on time.</p>
      <p style="color:#6b7280;font-size:13px;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:24px">
        You are receiving this email because you enabled reminders for this task in Orbit.<br>
        To disable reminders, edit the task and uncheck the Reminder option.
      </p>
    </div>
  `;

  if (!transporter) {
    console.log(`[EMAIL] No SMTP configured — task reminder for ${maskEmail(toEmail)}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@orbit.app',
    to: toEmail,
    subject,
    html,
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sendFeedbackEmail(toEmail, { username, userEmail, message }) {
  const subject = 'User Feedback';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
      <h2 style="color:#1a56db;border-bottom:2px solid #e5e7eb;padding-bottom:12px">User Feedback</h2>
      <div style="background:#f9fafb;border-left:4px solid #1a56db;padding:16px;border-radius:4px;margin:16px 0">
        <p style="margin:0 0 8px"><strong>Name:</strong> ${escapeHtml(username || '—')}</p>
        <p style="margin:0 0 8px"><strong>Email:</strong> ${escapeHtml(userEmail)}</p>
      </div>
      <h3 style="margin:20px 0 8px;font-size:14px;color:#374151">Message</h3>
      <div style="background:#fff;border:1px solid #e5e7eb;padding:16px;border-radius:4px;white-space:pre-wrap;font-size:14px;line-height:1.6">${escapeHtml(message)}</div>
    </div>
  `;

  if (!transporter) {
    console.log(`[EMAIL] No SMTP configured — feedback from ${maskEmail(userEmail)}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@orbit.app',
    to: toEmail,
    subject,
    html,
  });
}

module.exports = { sendPasswordResetEmail, sendVerificationEmail, sendTaskReminderEmail, sendUndueTasksDigestEmail, sendFeedbackEmail };
