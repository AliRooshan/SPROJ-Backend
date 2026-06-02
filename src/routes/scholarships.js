const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const toRequirementsArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split('\n').map(v => v.trim()).filter(Boolean);
  }
  return [];
};

// ── GET /api/scholarships ─────────────────────────────────────────────────────
// Public. Supports: ?country=UK  ?type=Merit-based  ?search=chevening
router.get('/', async (req, res) => {
  try {
    const { page, limit, countries, types, country, type, search, sort_by } = req.query;

    let whereClause = ' WHERE 1=1';
    const params = [];

    // Support countries array/comma-separated and country string
    const countriesVal = countries || country;
    if (countriesVal) {
      const list = String(countriesVal).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      if (list.length > 0) {
        params.push(list);
        whereClause += ` AND LOWER(co.name) = ANY($${params.length})`;
      }
    }

    // Support types array/comma-separated and type string
    const typesVal = types || type;
    if (typesVal) {
      const list = String(typesVal).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      if (list.length > 0) {
        params.push(list);
        whereClause += ` AND LOWER(s.type) = ANY($${params.length})`;
      }
    }

    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (LOWER(s.name) LIKE LOWER($${params.length}) OR LOWER(s.provider) LIKE LOWER($${params.length}) OR LOWER(co.name) LIKE LOWER($${params.length}))`;
    }

    // Build Order By
    let orderBy = ' ORDER BY s.id ASC';
    if (sort_by === 'amount_high') {
      orderBy = ' ORDER BY s.amount DESC NULLS LAST, s.id ASC';
    } else if (sort_by === 'amount_low') {
      orderBy = ' ORDER BY s.amount ASC NULLS LAST, s.id ASC';
    }

    // If page parameter is provided, we return paginated data
    if (page) {
      const countQuery = `
        SELECT COUNT(*)
        FROM scholarships s
        LEFT JOIN countries co ON co.id = s.country_id
        ${whereClause}
      `;
      const countRes = await pool.query(countQuery, params);
      const total = parseInt(countRes.rows[0].count, 10);

      const parsedPage = parseInt(page, 10) || 1;
      const parsedLimit = parseInt(limit, 10) || 15;
      const offset = (parsedPage - 1) * parsedLimit;

      const mainQuery = `
        SELECT s.*, co.name AS country
        FROM scholarships s
        LEFT JOIN countries co ON co.id = s.country_id
        ${whereClause}
        ${orderBy}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

      const result = await pool.query(mainQuery, [...params, parsedLimit, offset]);
      
      res.json({
        results: result.rows,
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      });
    } else {
      // Return full list (for backward compatibility)
      const mainQuery = `
        SELECT s.*, co.name AS country
        FROM scholarships s
        LEFT JOIN countries co ON co.id = s.country_id
        ${whereClause}
        ${orderBy}
      `;
      const result = await pool.query(mainQuery, params);
      res.json(result.rows);
    }
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

// ── GET /api/scholarships/countries ────────────────────────────────────────────
router.get('/countries', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM countries ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /scholarships/countries error:', err.message);
    res.status(500).json({ error: 'Failed to fetch countries' });
  }
});

// ── GET /api/scholarships/currencies ───────────────────────────────────────────
router.get('/currencies', async (req, res) => {
  try {
    const result = await pool.query('SELECT currency FROM currency_rates ORDER BY currency');
    res.json(result.rows.map(r => r.currency));
  } catch (err) {
    console.error('GET /scholarships/currencies error:', err.message);
    res.status(500).json({ error: 'Failed to fetch currencies' });
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
  [
    body('name').optional().trim().notEmpty().withMessage('Scholarship name cannot be empty'),
    body('provider').optional().trim().notEmpty().withMessage('provider cannot be empty'),
    body('amount').optional().isFloat({ min: 0 }).withMessage('amount must be >= 0'),
    body('deadline').optional().trim().notEmpty().withMessage('deadline cannot be empty'),
    body('country_id').optional().isInt({ min: 1 }).withMessage('country_id must be a valid ID'),
    body('type').optional().trim().notEmpty().withMessage('type cannot be empty'),
    body('description').optional().trim().notEmpty().withMessage('description cannot be empty'),
    body('requirements').optional().isArray().withMessage('requirements must be an array'),
    body('website').optional().isURL().withMessage('website must be a valid URL'),
    body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('currency must be 3 letters'),
    body('benefits').optional().isString().withMessage('benefits must be a string')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, provider, amount, deadline, country_id, type, description, requirements, website, currency, benefits } = req.body;

    try {
      if (country_id) {
        const countryCheck = await pool.query('SELECT id FROM countries WHERE id = $1', [country_id]);
        if (countryCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Unknown country_id' });
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
        `INSERT INTO scholarships (name, provider, amount, deadline, country_id, type, description, requirements, website, currency, benefits)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          name || null,
          provider || null,
          amount !== undefined ? amount : null,
          deadline || null,
          country_id || null,
          type || null,
          description || null,
          requirements !== undefined ? JSON.stringify(toRequirementsArray(requirements)) : '[]',
          website || null,
          currencyCode,
          benefits || null
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
  const { name, provider, amount, deadline, country_id, type, description, requirements, website, currency, benefits } = req.body;

  try {
    const current = await pool.query('SELECT * FROM scholarships WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Scholarship not found' });
    const existing = current.rows[0];

    const nextCountryId = country_id !== undefined ? country_id : existing.country_id;
    if (nextCountryId) {
      const countryCheck = await pool.query('SELECT id FROM countries WHERE id = $1', [nextCountryId]);
      if (countryCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown country_id' });
      }
    }

    const nextCurrency = currency !== undefined ? (currency ? String(currency).toUpperCase() : null) : existing.currency;
    if (nextCurrency) {
      const currencyCheck = await pool.query('SELECT currency FROM currency_rates WHERE currency = $1', [nextCurrency]);
      if (currencyCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown currency code' });
      }
    }
    const nextAmount = amount !== undefined ? (amount !== null ? Number(amount) : null) : existing.amount;
    if (nextAmount !== null && (!Number.isFinite(nextAmount) || nextAmount < 0)) {
      return res.status(400).json({ error: 'amount must be >= 0' });
    }

    const result = await pool.query(
      `UPDATE scholarships
       SET name=$1, provider=$2, amount=$3, deadline=$4, country_id=$5, type=$6,
           description=$7, requirements=$8, website=$9, currency=$10, benefits=$11
       WHERE id=$12
       RETURNING *`,
      [
        name !== undefined ? name : existing.name,
        provider !== undefined ? provider : existing.provider,
        nextAmount,
        deadline !== undefined ? deadline : existing.deadline,
        nextCountryId,
        type !== undefined ? type : existing.type,
        description !== undefined ? description : existing.description,
        requirements !== undefined ? JSON.stringify(toRequirementsArray(requirements)) : existing.requirements,
        website !== undefined ? website : existing.website,
        nextCurrency,
        benefits !== undefined ? benefits : existing.benefits,
        req.params.id
      ]
    );
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
