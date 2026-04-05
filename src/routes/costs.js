const express = require('express');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/costs ────────────────────────────────────────────────────────────
// Public. Returns all cities with their living cost data.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM living_costs ORDER BY city ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /costs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch living costs' });
  }
});

// ── PUT /api/costs/:id ────────────────────────────────────────────────────────
// Admin only. Update cost figures for a specific city.
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { city, country, rent, food, transport, currency } = req.body;

  try {
    const result = await pool.query(
      `UPDATE living_costs
       SET city=$1, country=$2, rent=$3, food=$4, transport=$5, currency=$6
       WHERE id=$7
       RETURNING *`,
      [city, country, rent, food, transport, currency, req.params.id]
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
