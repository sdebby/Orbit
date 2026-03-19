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

async function sendPasswordResetEmail(toEmail, resetLink) {
  const subject = 'Orbit — Password Reset';
  const html = `
    <p>You requested a password reset for your Orbit account.</p>
    <p><a href="${resetLink}">Click here to reset your password</a></p>
    <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
  `;

  if (!transporter) {
    console.log(`[EMAIL - no SMTP configured]\nTo: ${toEmail}\nSubject: ${subject}\n${resetLink}`);
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
    console.log(`[EMAIL - no SMTP configured]\nTo: ${toEmail}\nSubject: ${subject}\n${verifyLink}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@orbit.app',
    to: toEmail,
    subject,
    html,
  });
}

module.exports = { sendPasswordResetEmail, sendVerificationEmail };
