const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/programs ─────────────────────────────────────────────────────────
// Public. Supports query filters: ?country=UK  ?search=computer  ?tuition_max=20000
router.get('/', async (req, res) => {
  try {
    const { country, search, tuition_max, duration } = req.query;

    let query = 'SELECT * FROM programs WHERE 1=1';
    const params = [];

    if (country) {
      params.push(country);
      query += ` AND LOWER(country) = LOWER($${params.length})`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(program) LIKE LOWER($${params.length}) OR LOWER(university) LIKE LOWER($${params.length}))`;
    }
    if (tuition_max) {
      params.push(Number(tuition_max));
      query += ` AND tuition <= $${params.length}`;
    }
    if (duration) {
      params.push(`%${duration}%`);
      query += ` AND LOWER(duration) LIKE LOWER($${params.length})`;
    }

    query += ' ORDER BY id ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /programs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch programs' });
  }
});

// ── GET /api/programs/:id ─────────────────────────────────────────────────────
// Public.
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM programs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /programs/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch program' });
  }
});

// ── POST /api/programs ────────────────────────────────────────────────────────
// Admin only.
router.post(
  '/',
  authenticateToken,
  requireAdmin,
  [
    body('university').notEmpty().withMessage('University is required'),
    body('program').notEmpty().withMessage('Program name is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { university, program, country, city, deadline, tuition, currency, duration, description, eligibility, image, logo } = req.body;

    try {
      const result = await pool.query(
        `INSERT INTO programs (university, program, country, city, deadline, tuition, currency, duration, description, eligibility, image, logo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [university, program, country, city, deadline, tuition, currency, duration, description, eligibility, image, logo]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('POST /programs error:', err.message);
      res.status(500).json({ error: 'Failed to create program' });
    }
  }
);

// ── PUT /api/programs/:id ─────────────────────────────────────────────────────
// Admin only.
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { university, program, country, city, deadline, tuition, currency, duration, description, eligibility, image, logo } = req.body;

  try {
    const result = await pool.query(
      `UPDATE programs
       SET university=$1, program=$2, country=$3, city=$4, deadline=$5, tuition=$6,
           currency=$7, duration=$8, description=$9, eligibility=$10,
           image=$11, logo=$12
       WHERE id=$13
       RETURNING *`,
      [university, program, country, city, deadline, tuition, currency, duration, description, eligibility, image, logo, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Program not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /programs/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update program' });
  }
});

// ── DELETE /api/programs/:id ──────────────────────────────────────────────────
// Admin only.
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM programs WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Program not found' });
    res.json({ message: 'Program deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('DELETE /programs/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete program' });
  }
});

module.exports = router;
