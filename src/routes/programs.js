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
      query += ` AND p.tuition_amount <= $${params.length}`;
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
    body('university').notEmpty().withMessage('University is required'),
    body('program').notEmpty().withMessage('Program name is required'),
    body('country').notEmpty().withMessage('Country is required'),
    body('city').notEmpty().withMessage('City is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { university, program, country, city, deadline, tuition, currency, duration, description, eligibility, website, degree_level, field_of_study } = req.body;

    try {
      const countryExisting = await pool.query(
        'SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [country]
      );
      if (countryExisting.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown country' });
      }
      const countryId = countryExisting.rows[0].id;

      const cityRes = await pool.query(
        `INSERT INTO cities (name, country_id)
         VALUES ($1, $2)
         ON CONFLICT (name, country_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [city, countryId]
      );
      const cityId = cityRes.rows[0].id;

      const universityRes = await pool.query(
        `INSERT INTO universities (name, city_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [university, cityId]
      );
      const universityId = universityRes.rows[0]?.id
        || (await pool.query('SELECT id FROM universities WHERE name = $1 AND city_id = $2', [university, cityId])).rows[0].id;

      const result = await pool.query(
        `INSERT INTO programs (
          university_id, name, degree_level, field_of_study, deadline, tuition_amount,
          currency, duration, description, eligibility, website
        )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          universityId,
          program,
          degree_level || 'Master',
          field_of_study || 'General',
          deadline || null,
          tuition ?? 0,
          currency || 'USD',
          duration || 'N/A',
          description || null,
          JSON.stringify(eligibility || []),
          website || null
        ]
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
  const { university, program, country, city, deadline, tuition, currency, duration, description, eligibility, website, degree_level, field_of_study } = req.body;

  try {
    const countryExisting = await pool.query(
      'SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [country]
    );
    if (countryExisting.rows.length === 0) {
      return res.status(400).json({ error: 'Unknown country' });
    }
    const countryId = countryExisting.rows[0].id;

    const cityRes = await pool.query(
      `INSERT INTO cities (name, country_id)
       VALUES ($1, $2)
       ON CONFLICT (name, country_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [city, countryId]
    );
    const cityId = cityRes.rows[0].id;

    const universityRes = await pool.query(
      `INSERT INTO universities (name, city_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [university, cityId]
    );
    const universityId = universityRes.rows[0]?.id
      || (await pool.query('SELECT id FROM universities WHERE name = $1 AND city_id = $2', [university, cityId])).rows[0].id;

    const result = await pool.query(
      `UPDATE programs
       SET university_id=$1, name=$2, degree_level=$3, field_of_study=$4, deadline=$5,
           tuition_amount=$6, currency=$7, duration=$8, description=$9, eligibility=$10,
           website=$11
       WHERE id=$12
       RETURNING *`,
      [
        universityId,
        program,
        degree_level || 'Master',
        field_of_study || 'General',
        deadline || null,
        tuition ?? 0,
        currency || 'USD',
        duration || 'N/A',
        description || null,
        JSON.stringify(eligibility || []),
        website || null,
        req.params.id
      ]
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
