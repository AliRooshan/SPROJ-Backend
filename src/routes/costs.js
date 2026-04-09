const express = require('express');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/costs ────────────────────────────────────────────────────────────
// Public. Returns all cities with their living cost data.
router.get('/', async (req, res) => {
  try {
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
      ORDER BY c.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /costs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch living costs' });
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
      [cityLookup.rows[0].id, rent, food, transport, currency || 'USD', lifestyle || 'medium', req.params.id]
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

module.exports = router;
