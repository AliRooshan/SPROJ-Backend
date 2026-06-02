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
    const { page, limit, countries, degrees, durations, tuition_min, tuition_max, search, sort_by } = req.query;

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let userId = null;
    if (token) {
      try {
        const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
      } catch (err) {
        // Ignore invalid token
      }
    }

    const countriesVal = countries || req.query.country;
    const maxTuitionVal = tuition_max || req.query.tuition_max;

    let whereClause = ' WHERE 1=1';
    const params = [];

    if (countriesVal) {
      const list = String(countriesVal).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      if (list.length > 0) {
        params.push(list);
        whereClause += ` AND LOWER(co.name) = ANY($${params.length})`;
      }
    }
    if (degrees) {
      const list = String(degrees).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      if (list.length > 0) {
        params.push(list);
        whereClause += ` AND LOWER(p.degree_level) = ANY($${params.length})`;
      }
    }
    if (durations) {
      const list = String(durations).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      if (list.length > 0) {
        params.push(list);
        whereClause += ` AND LOWER(p.duration) = ANY($${params.length})`;
      }
    }
    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (LOWER(p.name) LIKE LOWER($${params.length}) OR LOWER(u.name) LIKE LOWER($${params.length}))`;
    }
    if (tuition_min) {
      params.push(Number(tuition_min));
      whereClause += ` AND COALESCE(p.standard_tuition, p.tuition_amount) >= $${params.length}`;
    }
    if (maxTuitionVal) {
      params.push(Number(maxTuitionVal));
      whereClause += ` AND COALESCE(p.standard_tuition, p.tuition_amount) <= $${params.length}`;
    }

    // Build Order By
    let orderBy = ' ORDER BY p.id ASC';
    if (sort_by === 'price_low') {
      orderBy = ' ORDER BY COALESCE(p.standard_tuition, p.tuition_amount) ASC, p.id ASC';
    } else if (sort_by === 'price_high') {
      orderBy = ' ORDER BY COALESCE(p.standard_tuition, p.tuition_amount) DESC, p.id ASC';
    } else if (sort_by === 'match_low' && userId) {
      orderBy = ' ORDER BY pm.match_score ASC NULLS LAST, p.id ASC';
    } else if (sort_by === 'match_high' && userId) {
      orderBy = ' ORDER BY pm.match_score DESC NULLS LAST, p.id ASC';
    }

    // If page parameter is provided, we return paginated data
    if (page) {
      const countQuery = `
        SELECT COUNT(*)
        FROM programs p
        JOIN universities u ON u.id = p.university_id
        JOIN cities c ON c.id = u.city_id
        JOIN countries co ON co.id = c.country_id
        ${whereClause}
      `;
      const countRes = await pool.query(countQuery, params);
      const total = parseInt(countRes.rows[0].count, 10);

      const parsedPage = parseInt(page, 10) || 1;
      const parsedLimit = parseInt(limit, 10) || 15;
      const offset = (parsedPage - 1) * parsedLimit;

      let mainQuery = '';
      let queryParams = [...params];
      if (userId) {
        queryParams.push(userId);
        const matchParamIndex = queryParams.length;
        mainQuery = `
          SELECT
            p.*,
            p.name AS program,
            p.tuition_amount AS tuition,
            u.name AS university,
            c.name AS city,
            co.name AS country,
            pm.match_score
          FROM programs p
          JOIN universities u ON u.id = p.university_id
          JOIN cities c ON c.id = u.city_id
          JOIN countries co ON co.id = c.country_id
          LEFT JOIN program_matches pm ON pm.program_id = p.id AND pm.student_id = $${matchParamIndex}
          ${whereClause}
          ${orderBy}
          LIMIT $${matchParamIndex + 1} OFFSET $${matchParamIndex + 2}
        `;
        queryParams.push(parsedLimit, offset);
      } else {
        mainQuery = `
          SELECT
            p.*,
            p.name AS program,
            p.tuition_amount AS tuition,
            u.name AS university,
            c.name AS city,
            co.name AS country,
            NULL::numeric AS match_score
          FROM programs p
          JOIN universities u ON u.id = p.university_id
          JOIN cities c ON c.id = u.city_id
          JOIN countries co ON co.id = c.country_id
          ${whereClause}
          ${orderBy}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        queryParams.push(parsedLimit, offset);
      }

      const result = await pool.query(mainQuery, queryParams);
      
      res.json({
        results: result.rows,
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      });
    } else {
      // Return full list (for backward compatibility)
      let mainQuery = '';
      let queryParams = [...params];
      if (userId) {
        queryParams.push(userId);
        const matchParamIndex = queryParams.length;
        mainQuery = `
          SELECT
            p.*,
            p.name AS program,
            p.tuition_amount AS tuition,
            u.name AS university,
            c.name AS city,
            co.name AS country,
            pm.match_score
          FROM programs p
          JOIN universities u ON u.id = p.university_id
          JOIN cities c ON c.id = u.city_id
          JOIN countries co ON co.id = c.country_id
          LEFT JOIN program_matches pm ON pm.program_id = p.id AND pm.student_id = $${matchParamIndex}
          ${whereClause}
          ${orderBy}
        `;
      } else {
        mainQuery = `
          SELECT
            p.*,
            p.name AS program,
            p.tuition_amount AS tuition,
            u.name AS university,
            c.name AS city,
            co.name AS country,
            NULL::numeric AS match_score
          FROM programs p
          JOIN universities u ON u.id = p.university_id
          JOIN cities c ON c.id = u.city_id
          JOIN countries co ON co.id = c.country_id
          ${whereClause}
          ${orderBy}
        `;
      }
      const result = await pool.query(mainQuery, queryParams);
      res.json(result.rows);
    }
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
    const maxTuitionRes = await pool.query('SELECT MAX(COALESCE(standard_tuition, tuition_amount)) AS max_tuition FROM programs');
    const maxTuition = Math.ceil(Number(maxTuitionRes.rows[0].max_tuition || 0));

    res.json({
      countries: countriesRes.rows.map(r => r.country),
      durations: durationsRes.rows.map(r => r.duration),
      degrees: degreesRes.rows.map(r => r.degree),
      maxTuition
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
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let userId = null;
    if (token) {
      try {
        const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
      } catch (err) {
        // Ignore
      }
    }

    let query = '';
    const params = [req.params.id];
    if (userId) {
      params.push(userId);
      query = `
        SELECT
          p.*,
          p.name AS program,
          p.tuition_amount AS tuition,
          u.name AS university,
          c.name AS city,
          co.name AS country,
          pm.match_score
        FROM programs p
        JOIN universities u ON u.id = p.university_id
        JOIN cities c ON c.id = u.city_id
        JOIN countries co ON co.id = c.country_id
        LEFT JOIN program_matches pm ON pm.program_id = p.id AND pm.student_id = $2
        WHERE p.id = $1
      `;
    } else {
      query = `
        SELECT
          p.*,
          p.name AS program,
          p.tuition_amount AS tuition,
          u.name AS university,
          c.name AS city,
          co.name AS country,
          NULL::numeric AS match_score
        FROM programs p
        JOIN universities u ON u.id = p.university_id
        JOIN cities c ON c.id = u.city_id
        JOIN countries co ON co.id = c.country_id
        WHERE p.id = $1
      `;
    }

    const result = await pool.query(query, params);
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
    body('university_id').optional().isInt({ min: 1 }).withMessage('Valid university_id must be a valid ID'),
    body('name').optional().trim().notEmpty().withMessage('Program name cannot be empty'),
    body('degree_level').optional().isIn(['Masters', 'PHD']).withMessage('degree_level must be Masters or PHD'),
    body('field_of_study').optional().trim().notEmpty().withMessage('field_of_study cannot be empty'),
    body('deadline').optional().trim().notEmpty().withMessage('deadline cannot be empty'),
    body('tuition_amount').optional().isFloat({ min: 0 }).withMessage('tuition_amount must be >= 0'),
    body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('currency must be 3-letter code'),
    body('duration').optional().trim().notEmpty().withMessage('duration cannot be empty'),
    body('description').optional().trim().notEmpty().withMessage('description cannot be empty'),
    body('eligibility').optional().isArray().withMessage('eligibility must be an array'),
    body('website').optional().isURL().withMessage('website must be a valid URL')
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
      if (university_id) {
        const uniCheck = await pool.query('SELECT id FROM universities WHERE id = $1', [university_id]);
        if (uniCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Unknown university_id' });
        }
      }
      let currencyCode = null;
      if (currency) {
        currencyCode = String(currency).toUpperCase();
        const currencyCheck = await pool.query('SELECT currency FROM currency_rates WHERE currency = $1', [currencyCode]);
        if (currencyCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Unknown currency code' });
        }
      } else {
        currencyCode = 'USD';
      }

      const result = await pool.query(
        `INSERT INTO programs (
          university_id, name, degree_level, field_of_study, deadline, tuition_amount,
          currency, duration, description, eligibility, website
        )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          university_id || null,
          name || null,
          degree_level || null,
          field_of_study || null,
          deadline || null,
          tuition_amount !== undefined ? tuition_amount : null,
          currencyCode,
          duration || null,
          description || null,
          eligibility !== undefined ? JSON.stringify(toEligibilityArray(eligibility)) : '[]',
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

    const nextUniversityId = university_id !== undefined ? university_id : existing.university_id;
    if (nextUniversityId) {
      const uniCheck = await pool.query('SELECT id FROM universities WHERE id = $1', [nextUniversityId]);
      if (uniCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown university_id' });
      }
    }
    const nextDegree = degree_level ?? existing.degree_level;
    if (nextDegree !== null && !['Masters', 'PHD'].includes(nextDegree)) {
      return res.status(400).json({ error: 'degree_level must be Masters or PHD' });
    }
    const nextTuition = tuition_amount !== undefined ? (tuition_amount !== null ? Number(tuition_amount) : null) : existing.tuition_amount;
    if (nextTuition !== null && nextTuition < 0) {
      return res.status(400).json({ error: 'tuition_amount must be >= 0' });
    }
    const nextCurrency = currency !== undefined ? (currency ? String(currency).toUpperCase() : null) : existing.currency;
    if (nextCurrency) {
      const currencyCheck = await pool.query('SELECT currency FROM currency_rates WHERE currency = $1', [nextCurrency]);
      if (currencyCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown currency code' });
      }
    }

    const result = await pool.query(
      `UPDATE programs
       SET university_id=$1, name=$2, degree_level=$3, field_of_study=$4, deadline=$5,
           tuition_amount=$6, currency=$7, duration=$8, description=$9, eligibility=$10,
           website=$11
       WHERE id=$12
       RETURNING *`,
      [
        nextUniversityId,
        name !== undefined ? name : existing.name,
        degree_level !== undefined ? degree_level : existing.degree_level,
        field_of_study !== undefined ? field_of_study : existing.field_of_study,
        deadline !== undefined ? deadline : existing.deadline,
        nextTuition,
        nextCurrency,
        duration !== undefined ? duration : existing.duration,
        description !== undefined ? description : existing.description,
        eligibility !== undefined ? JSON.stringify(toEligibilityArray(eligibility)) : existing.eligibility,
        website !== undefined ? website : existing.website,
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
