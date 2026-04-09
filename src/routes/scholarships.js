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

    let query = `
      SELECT s.*, co.name AS country
      FROM scholarships s
      LEFT JOIN countries co ON co.id = s.country_id
      WHERE 1=1
    `;
    const params = [];

    if (country) {
      params.push(country);
      query += ` AND LOWER(co.name) = LOWER($${params.length})`;
    }
    if (type) {
      params.push(type);
      query += ` AND LOWER(type) = LOWER($${params.length})`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(name) LIKE LOWER($${params.length}) OR LOWER(provider) LIKE LOWER($${params.length}))`;
    }

    query += ' ORDER BY s.id ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /scholarships error:', err.message);
    res.status(500).json({ error: 'Failed to fetch scholarships' });
  }
});

// ── GET /api/scholarships/filters ─────────────────────────────────────────────
// Public. Returns unique constraints.
router.get('/filters', async (req, res) => {
  try {
    const countriesRes = await pool.query(`
      SELECT DISTINCT co.name AS country
      FROM scholarships s
      JOIN countries co ON co.id = s.country_id
      ORDER BY co.name
    `);
    const typesRes = await pool.query('SELECT DISTINCT type FROM scholarships WHERE type IS NOT NULL ORDER BY type');

    res.json({
      countries: countriesRes.rows.map(r => r.country),
      types: typesRes.rows.map(r => r.type)
    });
  } catch (err) {
    console.error('GET /scholarships/filters error:', err.message);
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

// ── GET /api/scholarships/:id ─────────────────────────────────────────────────
// Public.
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, co.name AS country
       FROM scholarships s
       LEFT JOIN countries co ON co.id = s.country_id
       WHERE s.id = $1`,
      [req.params.id]
    );
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

    const { name, provider, amount, deadline, country, type, description, requirements, website, currency } = req.body;

    try {
      let countryId = null;
      if (country) {
        const countryResult = await pool.query(
          `SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [country]
        );
        if (countryResult.rows.length > 0) {
          countryId = countryResult.rows[0].id;
        }
      }

      const result = await pool.query(
        `INSERT INTO scholarships (name, provider, amount, deadline, country_id, type, description, requirements, website, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          name,
          provider,
          amount ?? 0,
          deadline,
          countryId,
          type || 'merit',
          description || null,
          JSON.stringify(requirements || []),
          website || null,
          currency || 'USD'
        ]
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
  const { name, provider, amount, deadline, country, type, description, requirements, website, currency } = req.body;

  try {
    let countryId = null;
    if (country) {
      const countryResult = await pool.query(
        `SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [country]
      );
      if (countryResult.rows.length > 0) {
        countryId = countryResult.rows[0].id;
      }
    }

    const result = await pool.query(
      `UPDATE scholarships
       SET name=$1, provider=$2, amount=$3, deadline=$4, country_id=$5, type=$6,
           description=$7, requirements=$8, website=$9, currency=$10
       WHERE id=$11
       RETURNING *`,
      [
        name,
        provider,
        amount ?? 0,
        deadline,
        countryId,
        type || 'merit',
        description || null,
        JSON.stringify(requirements || []),
        website || null,
        currency || 'USD',
        req.params.id
      ]
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
