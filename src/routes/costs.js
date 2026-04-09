const express = require('express');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/costs ────────────────────────────────────────────────────────────
// Public. Returns all cities with their living cost data.
router.get('/', async (req, res) => {
  try {
    const { lifestyle } = req.query;
    const params = [];
    let whereClause = '';
    if (lifestyle) {
      params.push(String(lifestyle).toLowerCase());
      whereClause = `WHERE LOWER(lc.lifestyle) = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT
        lc.*,
        c.name AS city,
        co.name AS country,
        lc.rent_monthly AS rent,
        lc.food_monthly AS food,
        lc.transport_monthly AS transport
      FROM living_costs lc
      JOIN cities c ON c.id = lc.city_id
      JOIN countries co ON co.id = c.country_id
      ${whereClause}
      ORDER BY c.name ASC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /costs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch living costs' });
  }
});

// ── POST /api/costs ───────────────────────────────────────────────────────────
// Admin only. Create living cost row (country must exist; city is created if missing).
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { city, country, rent, food, transport, currency, lifestyle } = req.body;
  const life = String(lifestyle || 'medium').toLowerCase();
  if (!['low', 'medium', 'high'].includes(life)) {
    return res.status(400).json({ error: 'lifestyle must be low, medium, or high' });
  }
  const cityName = String(city || '').trim();
  const countryName = String(country || '').trim();
  if (!cityName || !countryName) {
    return res.status(400).json({ error: 'city and country are required' });
  }
  const r = Number(rent);
  const f = Number(food);
  const t = Number(transport);
  if (![r, f, t].every((n) => Number.isFinite(n) && n >= 0)) {
    return res.status(400).json({ error: 'rent, food, and transport must be non-negative numbers' });
  }
  const cur = String(currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) {
    return res.status(400).json({ error: 'currency must be a 3-letter ISO code' });
  }

  try {
    const countryRes = await pool.query(
      `SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [countryName]
    );
    if (countryRes.rows.length === 0) {
      return res.status(400).json({ error: 'Unknown country. Add the country in the database first.' });
    }
    const countryId = countryRes.rows[0].id;

    let cityRes = await pool.query(
      `SELECT id FROM cities WHERE LOWER(name) = LOWER($1) AND country_id = $2 LIMIT 1`,
      [cityName, countryId]
    );
    let cityId;
    if (cityRes.rows.length > 0) {
      cityId = cityRes.rows[0].id;
    } else {
      const insertCity = await pool.query(
        `INSERT INTO cities (name, country_id) VALUES ($1, $2) RETURNING id`,
        [cityName, countryId]
      );
      cityId = insertCity.rows[0].id;
    }

    const dup = await pool.query(
      `SELECT id FROM living_costs WHERE city_id = $1 AND LOWER(lifestyle) = LOWER($2) LIMIT 1`,
      [cityId, life]
    );
    if (dup.rows.length > 0) {
      return res.status(400).json({ error: 'Living cost already exists for this city and lifestyle' });
    }

    const result = await pool.query(
      `INSERT INTO living_costs (city_id, rent_monthly, food_monthly, transport_monthly, currency, lifestyle)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [cityId, r, f, t, cur, life]
    );

    const row = await pool.query(
      `SELECT
         lc.*,
         c.name AS city,
         co.name AS country,
         lc.rent_monthly AS rent,
         lc.food_monthly AS food,
         lc.transport_monthly AS transport
       FROM living_costs lc
       JOIN cities c ON c.id = lc.city_id
       JOIN countries co ON co.id = c.country_id
       WHERE lc.id = $1`,
      [result.rows[0].id]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) {
    console.error('POST /costs error:', err.message);
    res.status(500).json({ error: 'Failed to create living cost' });
  }
});

// ── PUT /api/costs/:id ────────────────────────────────────────────────────────
// Admin only. Update cost figures for a specific city.
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { city, country, rent, food, transport, currency, lifestyle } = req.body;

  try {
    const cityLookup = await pool.query(
      `SELECT c.id
       FROM cities c
       JOIN countries co ON co.id = c.country_id
       WHERE LOWER(c.name) = LOWER($1) AND LOWER(co.name) = LOWER($2)
       LIMIT 1`,
      [city, country]
    );
    if (cityLookup.rows.length === 0) {
      return res.status(400).json({ error: 'Unknown city/country pair' });
    }

    const result = await pool.query(
      `UPDATE living_costs
       SET city_id=$1, rent_monthly=$2, food_monthly=$3, transport_monthly=$4, currency=$5, lifestyle=$6
       WHERE id=$7
       RETURNING *`,
      [cityLookup.rows[0].id, Number(rent), Number(food), Number(transport), String(currency || 'USD').toUpperCase(), lifestyle || 'medium', req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'City not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /costs/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update living costs' });
  }
});

// ── DELETE /api/costs/:id ───────────────────────────────────────────────────
// Admin only. Remove a living cost row.
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid living cost id' });
  }
  try {
    const result = await pool.query(
      `DELETE FROM living_costs WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Living cost not found' });
    }
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('DELETE /costs/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete living cost' });
  }
});

// ── GET /api/costs/currency-rates ─────────────────────────────────────────────
// Admin helper. Return all currency rates.
router.get('/currency-rates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT currency, rate_to_usd
       FROM currency_rates
       ORDER BY currency ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /costs/currency-rates error:', err.message);
    res.status(500).json({ error: 'Failed to fetch currency rates' });
  }
});

// ── POST /api/costs/currency-rates ────────────────────────────────────────────
// Admin only. Add new currency rate.
router.post('/currency-rates', authenticateToken, requireAdmin, async (req, res) => {
  const { currency, rate_to_usd } = req.body;
  try {
    const code = String(currency || '').trim().toUpperCase();
    const rate = Number(rate_to_usd);
    if (!/^[A-Z]{3}$/.test(code)) {
      return res.status(400).json({ error: 'currency must be 3-letter ISO code' });
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ error: 'rate_to_usd must be > 0' });
    }

    const result = await pool.query(
      `INSERT INTO currency_rates (currency, rate_to_usd)
       VALUES ($1, $2)
       RETURNING currency, rate_to_usd`,
      [code, rate]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /costs/currency-rates error:', err.message);
    res.status(500).json({ error: 'Failed to create currency rate' });
  }
});

// ── PUT /api/costs/currency-rates/:currency ───────────────────────────────────
// Admin only. Update existing currency rate.
router.put('/currency-rates/:currency', authenticateToken, requireAdmin, async (req, res) => {
  const { rate_to_usd } = req.body;
  try {
    const code = String(req.params.currency || '').trim().toUpperCase();
    const rate = Number(rate_to_usd);
    if (!/^[A-Z]{3}$/.test(code)) {
      return res.status(400).json({ error: 'currency must be 3-letter ISO code' });
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ error: 'rate_to_usd must be > 0' });
    }

    const result = await pool.query(
      `UPDATE currency_rates
       SET rate_to_usd = $1
       WHERE currency = $2
       RETURNING currency, rate_to_usd`,
      [rate, code]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Currency not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /costs/currency-rates/:currency error:', err.message);
    res.status(500).json({ error: 'Failed to update currency rate' });
  }
});

// ── DELETE /api/costs/currency-rates/:currency ───────────────────────────────
// Admin only. Remove a currency rate row.
router.delete('/currency-rates/:currency', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const code = String(req.params.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return res.status(400).json({ error: 'currency must be 3-letter ISO code' });
    }

    const result = await pool.query(
      `DELETE FROM currency_rates WHERE currency = $1 RETURNING currency`,
      [code]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Currency not found' });
    }
    res.json({ ok: true, currency: result.rows[0].currency });
  } catch (err) {
    console.error('DELETE /costs/currency-rates/:currency error:', err.message);
    res.status(500).json({ error: 'Failed to delete currency rate' });
  }
});

module.exports = router;
