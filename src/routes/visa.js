const express = require('express');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/visa ──────────────────────────────────────────────────────────────
// Public. Returns all countries' visa guidance.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM visa_guidance ORDER BY country ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /visa error:', err.message);
    res.status(500).json({ error: 'Failed to fetch visa guidance' });
  }
});

// ── GET /api/visa/:country ─────────────────────────────────────────────────────
// Public. Returns visa guidance for a specific country (case-insensitive).
router.get('/:country', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM visa_guidance WHERE LOWER(country) = LOWER($1)',
      [req.params.country]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Visa guidance not found for this country' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /visa/:country error:', err.message);
    res.status(500).json({ error: 'Failed to fetch visa guidance' });
  }
});


// ── POST /api/visa ─────────────────────────────────────────────────────────────
// Admin only. Create a new country entry.
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { country, steps, documents } = req.body;
  if (!country) return res.status(400).json({ error: 'country is required' });

  try {
    const result = await pool.query(
      `INSERT INTO visa_guidance (country, steps, documents)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [country, JSON.stringify(steps || []), documents || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Visa guidance for this country already exists' });
    }
    console.error('POST /visa error:', err.message);
    res.status(500).json({ error: 'Failed to create visa guidance' });
  }
});

// ── PUT /api/visa/:country ─────────────────────────────────────────────────────
// Admin only. Update steps and/or documents for a country.
router.put('/:country', authenticateToken, requireAdmin, async (req, res) => {
  const { steps, documents } = req.body;

  try {
    const result = await pool.query(
      `UPDATE visa_guidance
       SET steps=$1, documents=$2
       WHERE LOWER(country) = LOWER($3)
       RETURNING *`,
      [JSON.stringify(steps || []), documents || [], req.params.country]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Visa guidance not found for this country' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /visa/:country error:', err.message);
    res.status(500).json({ error: 'Failed to update visa guidance' });
  }
});

// ── DELETE /api/visa/:country ──────────────────────────────────────────────────
// Admin only.
router.delete('/:country', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM visa_guidance WHERE LOWER(country) = LOWER($1) RETURNING id',
      [req.params.country]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Visa guidance not found for this country' });
    }
    res.json({ message: 'Visa guidance deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('DELETE /visa/:country error:', err.message);
    res.status(500).json({ error: 'Failed to delete visa guidance' });
  }
});

module.exports = router;
