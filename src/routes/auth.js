const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
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

module.exports = router;
