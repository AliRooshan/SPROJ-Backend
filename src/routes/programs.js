const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const toEligibilityArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split('\n').map(v => v.trim()).filter(Boolean);
  }
  return [];
};

// ── GET /api/programs ─────────────────────────────────────────────────────────
// Public. Supports query filters: ?country=UK  ?search=computer  ?tuition_max=20000
router.get('/', async (req, res) => {
  try {
    const { country, search, tuition_max, duration } = req.query;

    let query = `
      SELECT
        p.*,
        p.name AS program,
        p.tuition_amount AS tuition,
        u.name AS university,
        c.name AS city,
        co.name AS country
      FROM programs p
      JOIN universities u ON u.id = p.university_id
      JOIN cities c ON c.id = u.city_id
      JOIN countries co ON co.id = c.country_id
      WHERE 1=1
    `;
    const params = [];

    if (country) {
      params.push(country);
      query += ` AND LOWER(co.name) = LOWER($${params.length})`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(p.name) LIKE LOWER($${params.length}) OR LOWER(u.name) LIKE LOWER($${params.length}))`;
    }
    if (tuition_max) {
      params.push(Number(tuition_max));
      query += ` AND COALESCE(p.standard_tuition, p.tuition_amount) <= $${params.length}`;
    }
    if (duration) {
      params.push(`%${duration}%`);
      query += ` AND LOWER(p.duration) LIKE LOWER($${params.length})`;
    }

    query += ' ORDER BY p.id ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /programs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch programs' });
  }
});

// ── GET /api/programs/filters ─────────────────────────────────────────────────
// Public. Returns unique constraints.
router.get('/filters', async (req, res) => {
  try {
    const countriesRes = await pool.query(`
      SELECT DISTINCT co.name AS country
      FROM programs p
      JOIN universities u ON u.id = p.university_id
      JOIN cities c ON c.id = u.city_id
      JOIN countries co ON co.id = c.country_id
      ORDER BY co.name
    `);
    const durationsRes = await pool.query('SELECT DISTINCT duration FROM programs WHERE duration IS NOT NULL ORDER BY duration');
    const degreesRes = await pool.query('SELECT DISTINCT degree_level AS degree FROM programs WHERE degree_level IS NOT NULL ORDER BY degree_level');

    res.json({
      countries: countriesRes.rows.map(r => r.country),
      durations: durationsRes.rows.map(r => r.duration),
      degrees: degreesRes.rows.map(r => r.degree)
    });
  } catch (err) {
    console.error('GET /programs/filters error:', err.message);
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

// ── GET /api/programs/universities ────────────────────────────────────────────
// Public/Admin helper. Returns universities with location info.
router.get('/universities', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, c.name AS city, co.name AS country
       FROM universities u
       JOIN cities c ON c.id = u.city_id
       JOIN countries co ON co.id = c.country_id
       ORDER BY u.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /programs/universities error:', err.message);
    res.status(500).json({ error: 'Failed to fetch universities' });
  }
});

// ── GET /api/programs/currencies ───────────────────────────────────────────────
// Public/Admin helper. Returns active currencies from currency_rates.
router.get('/currencies', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT currency
       FROM currency_rates
       ORDER BY currency ASC`
    );
    res.json(result.rows.map(r => r.currency));
  } catch (err) {
    console.error('GET /programs/currencies error:', err.message);
    res.status(500).json({ error: 'Failed to fetch currencies' });
  }
});

// ── GET /api/programs/:id ─────────────────────────────────────────────────────
// Public.
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         p.*,
         p.name AS program,
         p.tuition_amount AS tuition,
         u.name AS university,
         c.name AS city,
         co.name AS country
       FROM programs p
       JOIN universities u ON u.id = p.university_id
       JOIN cities c ON c.id = u.city_id
       JOIN countries co ON co.id = c.country_id
       WHERE p.id = $1`,
      [req.params.id]
    );
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
    body('university_id').isInt({ min: 1 }).withMessage('Valid university_id is required'),
    body('name').trim().notEmpty().withMessage('Program name is required'),
    body('degree_level').isIn(['Masters', 'PHD']).withMessage('degree_level must be Masters or PHD'),
    body('field_of_study').trim().notEmpty().withMessage('field_of_study is required'),
    body('deadline').trim().notEmpty().withMessage('deadline is required'),
    body('tuition_amount').isFloat({ gt: 0 }).withMessage('tuition_amount must be > 0'),
    body('currency').isLength({ min: 3, max: 3 }).withMessage('currency must be 3-letter code'),
    body('duration').trim().notEmpty().withMessage('duration is required'),
    body('description').trim().notEmpty().withMessage('description is required'),
    body('eligibility').isArray({ min: 1 }).withMessage('eligibility is required'),
    body('website').isURL().withMessage('website must be a valid URL')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      university_id,
      name,
      degree_level,
      field_of_study,
      deadline,
      tuition_amount,
      currency,
      duration,
      description,
      eligibility,
      website
    } = req.body;

    try {
      const uniCheck = await pool.query('SELECT id FROM universities WHERE id = $1', [university_id]);
      if (uniCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown university_id' });
      }
      const currencyCheck = await pool.query('SELECT currency FROM currency_rates WHERE currency = $1', [String(currency).toUpperCase()]);
      if (currencyCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown currency code' });
      }

      const result = await pool.query(
        `INSERT INTO programs (
          university_id, name, degree_level, field_of_study, deadline, tuition_amount,
          currency, duration, description, eligibility, website
        )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          university_id,
          name,
          degree_level,
          field_of_study,
          deadline || null,
          tuition_amount,
          String(currency).toUpperCase(),
          duration,
          description || null,
          JSON.stringify(toEligibilityArray(eligibility)),
          website || null
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('POST /programs error:', err.message);
      res.status(500).json({ error: err.message || 'Failed to create program' });
    }
  }
);

// ── PUT /api/programs/:id ─────────────────────────────────────────────────────
// Admin only.
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const {
    university_id,
    name,
    degree_level,
    field_of_study,
    deadline,
    tuition_amount,
    currency,
    duration,
    description,
    eligibility,
    website
  } = req.body;

  try {
    const current = await pool.query('SELECT * FROM programs WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Program not found' });
    const existing = current.rows[0];

    if (university_id) {
      const uniCheck = await pool.query('SELECT id FROM universities WHERE id = $1', [university_id]);
      if (uniCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown university_id' });
      }
    }
    const nextDegree = degree_level ?? existing.degree_level;
    if (!['Masters', 'PHD'].includes(nextDegree)) {
      return res.status(400).json({ error: 'degree_level must be Masters or PHD' });
    }
    const nextTuition = tuition_amount ?? existing.tuition_amount;
    if (Number(nextTuition) <= 0) {
      return res.status(400).json({ error: 'tuition_amount must be > 0' });
    }
    const nextCurrency = String(currency || existing.currency).toUpperCase();
    const currencyCheck = await pool.query('SELECT currency FROM currency_rates WHERE currency = $1', [nextCurrency]);
    if (currencyCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Unknown currency code' });
    }

    const result = await pool.query(
      `UPDATE programs
       SET university_id=$1, name=$2, degree_level=$3, field_of_study=$4, deadline=$5,
           tuition_amount=$6, currency=$7, duration=$8, description=$9, eligibility=$10,
           website=$11
       WHERE id=$12
       RETURNING *`,
      [
        university_id || existing.university_id,
        name ?? existing.name,
        degree_level ?? existing.degree_level,
        field_of_study ?? existing.field_of_study,
        deadline ?? existing.deadline,
        tuition_amount ?? existing.tuition_amount,
        nextCurrency,
        duration ?? existing.duration,
        description ?? existing.description,
        JSON.stringify(eligibility !== undefined ? toEligibilityArray(eligibility) : existing.eligibility),
        website ?? existing.website,
        req.params.id
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /programs/:id error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update program' });
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
