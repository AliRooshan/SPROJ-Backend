const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/scholarships ─────────────────────────────────────────────────────
// Public. Supports: ?country=UK  ?type=Merit-based  ?search=chevening
router.get('/', async (req, res) => {
  try {
    const { country, type, search } = req.query;

    let query = 'SELECT * FROM scholarships WHERE 1=1';
    const params = [];

    if (country) {
      params.push(country);
      query += ` AND LOWER(country) = LOWER($${params.length})`;
    }
    if (type) {
      params.push(type);
      query += ` AND LOWER(type) = LOWER($${params.length})`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(name) LIKE LOWER($${params.length}) OR LOWER(provider) LIKE LOWER($${params.length}))`;
    }

    query += ' ORDER BY id ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /scholarships error:', err.message);
    res.status(500).json({ error: 'Failed to fetch scholarships' });
  }
});

// ── GET /api/scholarships/:id ─────────────────────────────────────────────────
// Public.
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM scholarships WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scholarship not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /scholarships/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch scholarship' });
  }
});

// ── POST /api/scholarships ────────────────────────────────────────────────────
// Admin only.
router.post(
  '/',
  authenticateToken,
  requireAdmin,
  [body('name').notEmpty().withMessage('Scholarship name is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, provider, amount, deadline, country, type, status } = req.body;

    try {
      const result = await pool.query(
        `INSERT INTO scholarships (name, provider, amount, deadline, country, type, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [name, provider, amount, deadline, country, type, status]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('POST /scholarships error:', err.message);
      res.status(500).json({ error: 'Failed to create scholarship' });
    }
  }
);

// ── PUT /api/scholarships/:id ─────────────────────────────────────────────────
// Admin only.
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { name, provider, amount, deadline, country, type, status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE scholarships
       SET name=$1, provider=$2, amount=$3, deadline=$4, country=$5, type=$6, status=$7
       WHERE id=$8
       RETURNING *`,
      [name, provider, amount, deadline, country, type, status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Scholarship not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /scholarships/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update scholarship' });
  }
});

// ── DELETE /api/scholarships/:id ──────────────────────────────────────────────
// Admin only.
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM scholarships WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Scholarship not found' });
    res.json({ message: 'Scholarship deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('DELETE /scholarships/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete scholarship' });
  }
});

module.exports = router;
