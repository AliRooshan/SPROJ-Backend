const express = require('express');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/visa ──────────────────────────────────────────────────────────────
// Public. Returns all countries' visa guidance.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT vg.*, co.name AS country
      FROM visa_guidance vg
      JOIN countries co ON co.id = vg.country_id
      ORDER BY co.name ASC
    `);
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
      `SELECT vg.*, co.name AS country
       FROM visa_guidance vg
       JOIN countries co ON co.id = vg.country_id
       WHERE LOWER(co.name) = LOWER($1)`,
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
    const countryResult = await pool.query(
      `SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [country]
    );
    if (countryResult.rows.length === 0) {
      return res.status(400).json({ error: 'Unknown country' });
    }

    const result = await pool.query(
      `INSERT INTO visa_guidance (country_id, steps, documents)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [countryResult.rows[0].id, JSON.stringify(steps || []), JSON.stringify(documents || [])]
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
    const countryResult = await pool.query(
      `SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [req.params.country]
    );
    if (countryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Visa guidance not found for this country' });
    }

    const result = await pool.query(
      `UPDATE visa_guidance
       SET steps=$1, documents=$2
       WHERE country_id = $3
       RETURNING *`,
      [JSON.stringify(steps || []), JSON.stringify(documents || []), countryResult.rows[0].id]
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
    const countryResult = await pool.query(
      `SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [req.params.country]
    );
    if (countryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Visa guidance not found for this country' });
    }

    const result = await pool.query(
      'DELETE FROM visa_guidance WHERE country_id = $1 RETURNING id',
      [countryResult.rows[0].id]
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
