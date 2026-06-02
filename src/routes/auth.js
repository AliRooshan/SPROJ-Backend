const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ── Helper: generate JWT ───────────────────────────────────────────────────────
const signToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, is_admin: user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('full_name').notEmpty().withMessage('Full name required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, full_name, phone } = req.body;

    try {
      // Check if user already exists
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Hash password
      const password_hash = await bcrypt.hash(password, 12);

      // Insert new user
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, full_name, phone, is_admin, created_at`,
        [email, password_hash, full_name, phone || null]
      );

      const user = result.rows[0];
      const token = signToken(user);

      res.status(201).json({
        message: 'Account created successfully',
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          is_admin: user.is_admin,
          created_at: user.created_at
        }
      });
    } catch (err) {
      console.error('Register error:', err.message);
      res.status(500).json({ error: 'Server error during registration' });
    }
  }
);

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const result = await pool.query(
        `SELECT u.id, u.email, u.password_hash, u.full_name, u.phone, u.is_admin, u.created_at,
                up.degree_level, up.major, up.gpa, up.english_test, up.english_score,
                up.target_countries, up.intake_term, up.budget_min, up.budget_max,
                up.budget_currency, up.career_goal
         FROM users u
         LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE u.email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = signToken(user);

      // Return user without password_hash
      const { password_hash, ...safeUser } = user;

      res.json({
        message: 'Login successful',
        token,
        user: safeUser
      });
    } catch (err) {
      console.error('Login error:', err.message);
      res.status(500).json({ error: 'Server error during login' });
    }
  }
);

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.is_admin, u.created_at,
              up.degree_level, up.major, up.gpa, up.english_test, up.english_score,
              up.target_countries, up.intake_term, up.budget_min, up.budget_max,
              up.budget_currency, up.career_goal
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Get me error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/auth/me ──────────────────────────────────────────────────────────
router.put('/me', authenticateToken, async (req, res) => {
  const { full_name, phone } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone)
       WHERE id = $3
       RETURNING id, email, full_name, phone, is_admin, created_at`,
      [full_name ?? null, phone ?? null, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'Account updated', user: result.rows[0] });
  } catch (err) {
    console.error('PUT /auth/me error:', err.message);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// ── PUT /api/auth/change-password ──────────────────────────────────────────────
router.put(
  '/change-password',
  authenticateToken,
  [
    body('current_password').notEmpty().withMessage('Current password is required'),
    body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    body('confirm_password').notEmpty().withMessage('Confirm password is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { current_password, new_password, confirm_password } = req.body;
    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'New password and confirm password do not match' });
    }

    try {
      const userResult = await pool.query(
        'SELECT id, password_hash FROM users WHERE id = $1',
        [req.user.id]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];
      const matches = await bcrypt.compare(current_password, user.password_hash);
      if (!matches) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      const sameAsCurrent = await bcrypt.compare(new_password, user.password_hash);
      if (sameAsCurrent) {
        return res.status(400).json({ error: 'New password must be different from current password' });
      }

      const newHash = await bcrypt.hash(new_password, 12);
      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [newHash, req.user.id]
      );

      res.json({ message: 'Password updated successfully' });
    } catch (err) {
      console.error('PUT /auth/change-password error:', err.message);
      res.status(500).json({ error: 'Failed to update password' });
    }
  }
);

// ── Email Helper ──────────────────────────────────────────────────────────────
const sendResetEmail = async (email, resetUrl) => {
  // Option A: Resend API (HTTP-based, works on Render Free Tier)
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const fromEmail = process.env.MAIL_FROM || 'onboarding@resend.dev';
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`
        },
        body: JSON.stringify({
          from: `EdVoyage Support <${fromEmail}>`,
          to: [email],
          subject: 'Reset Your EdVoyage Password',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
              <h2 style="color: #4f46e5; text-align: center; margin-bottom: 20px;">EdVoyage Password Reset</h2>
              <p style="font-size: 16px; color: #374151; line-height: 1.5;">Hello,</p>
              <p style="font-size: 16px; color: #374151; line-height: 1.5;">You requested to reset your password for your EdVoyage account. Please click the button below to reset it. This link is valid for 1 hour.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background: linear-gradient(to right, #4f46e5, #9333ea); color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);">Reset Password</a>
              </div>
              <p style="font-size: 14px; color: #4b5563;">If the button above does not work, copy and paste the following URL into your browser:</p>
              <p style="word-break: break-all; color: #2563eb; font-size: 14px; background-color: #f3f4f6; padding: 10px; border-radius: 6px; font-family: monospace;">${resetUrl}</p>
              <p style="margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 20px; color: #9ca3af; font-size: 12px; text-align: center;">
                If you did not request a password reset, please ignore this email.
              </p>
            </div>
          `
        })
      });

      if (response.ok) {
        console.log(`Password reset email successfully sent via Resend to ${email}`);
        return true;
      } else {
        const errorData = await response.json();
        console.error('Failed to send email via Resend:', errorData);
      }
    } catch (err) {
      console.error('Resend API error:', err.message);
    }
  }

  // Option B: Standard SMTP (Gmail, etc. - blocked on Render Free Tier)
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '') : null;

  if (!smtpUser || !smtpPass) {
    console.log('\n==================================================');
    console.log(`[DEVELOPMENT ONLY] SMTP credentials not fully set.`);
    console.log(`Password reset link for ${email}:`);
    console.log(resetUrl);
    console.log('==================================================\n');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: smtpUser,
      pass: smtpPass
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    family: 4
  });

  const mailOptions = {
    from: `"EdVoyage Support" <${smtpUser}>`,
    to: email,
    subject: 'Reset Your EdVoyage Password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
        <h2 style="color: #4f46e5; text-align: center; margin-bottom: 20px;">EdVoyage Password Reset</h2>
        <p style="font-size: 16px; color: #374151; line-height: 1.5;">Hello,</p>
        <p style="font-size: 16px; color: #374151; line-height: 1.5;">You requested to reset your password for your EdVoyage account. Please click the button below to reset it. This link is valid for 1 hour.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: linear-gradient(to right, #4f46e5, #9333ea); color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);">Reset Password</a>
        </div>
        <p style="font-size: 14px; color: #4b5563;">If the button above does not work, copy and paste the following URL into your browser:</p>
        <p style="word-break: break-all; color: #2563eb; font-size: 14px; background-color: #f3f4f6; padding: 10px; border-radius: 6px; font-family: monospace;">${resetUrl}</p>
        <p style="margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 20px; color: #9ca3af; font-size: 12px; text-align: center;">
          If you did not request a password reset, please ignore this email.
        </p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Password reset email successfully sent to ${email}`);
    return true;
  } catch (err) {
    console.error(`Failed to send email via SMTP:`, err.message);
    console.log('\n==================================================');
    console.log(`[FALLBACK] Password reset link for ${email}:`);
    console.log(resetUrl);
    console.log('==================================================\n');
    return false;
  }
};

// ── POST /api/auth/forgot-password ─────────────────────────────────────────────
router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('Valid email required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    try {
      // Check if user exists
      const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'No account found with this email address.' });
      }

      // Generate secure 32-byte hex token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour

      // Save token in DB, clearing existing ones for this email first
      await pool.query('DELETE FROM password_resets WHERE email = $1', [email]);
      await pool.query(
        'INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, $3)',
        [email, token, expiresAt]
      );

      // Create reset link
      const corsOrigins = process.env.CORS_ORIGIN || 'http://localhost:5173';
      const frontendUrl = process.env.FRONTEND_URL || corsOrigins.split(',')[0].trim();
      const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

      // Send reset mail / fallback
      await sendResetEmail(email, resetUrl);

      res.json({ message: 'A password reset link has been sent to your email.' });
    } catch (err) {
      console.error('POST /auth/forgot-password error:', err.message);
      res.status(500).json({ error: 'Failed to process forgot password request' });
    }
  }
);

// ── POST /api/auth/reset-password ──────────────────────────────────────────────
router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, password } = req.body;

    try {
      // Find token
      const tokenResult = await pool.query(
        'SELECT email, expires_at FROM password_resets WHERE token = $1',
        [token]
      );

      if (tokenResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired password reset token' });
      }

      const { email, expires_at } = tokenResult.rows[0];

      // Check expiry
      if (new Date() > new Date(expires_at)) {
        await pool.query('DELETE FROM password_resets WHERE token = $1', [token]);
        return res.status(400).json({ error: 'Invalid or expired password reset token' });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(password, 12);

      // Update password
      const updateResult = await pool.query(
        'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id',
        [passwordHash, email]
      );

      if (updateResult.rows.length === 0) {
        return res.status(404).json({ error: 'User account not found' });
      }

      // Clean up token
      await pool.query('DELETE FROM password_resets WHERE email = $1', [email]);

      res.json({ message: 'Password has been reset successfully. You can now log in with your new password.' });
    } catch (err) {
      console.error('POST /auth/reset-password error:', err.message);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  }
);

module.exports = router;
