const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ── Guard: ensure the requesting user can only access their own data ───────────
const isSelf = (req, res, next) => {
  if (req.user.id !== req.params.id && !req.user.is_admin) {
    return res.status(403).json({ error: 'Forbidden — you can only access your own data' });
  }
  next();
};

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════════════════════════════

// ── PUT /api/users/:id/profile ────────────────────────────────────────────────
router.put('/:id/profile', authenticateToken, isSelf, async (req, res) => {
  const { full_name, phone, degree, major, gpa, english_test, english_score, target_countries, intake, budget, career_goal } = req.body;

  try {
    const result = await pool.query(
      `UPDATE users
       SET full_name=$1, phone=$2, degree=$3, major=$4, gpa=$5,
           english_test=$6, english_score=$7, target_countries=$8,
           intake=$9, budget=$10, career_goal=$11
       WHERE id=$12
       RETURNING id, email, full_name, phone, degree, major, gpa,
                 english_test, english_score, target_countries, intake,
                 budget, career_goal, is_admin, created_at`,
      [full_name, phone, degree, major, gpa, english_test, english_score, target_countries, intake, budget, career_goal, req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'Profile updated', user: result.rows[0] });
  } catch (err) {
    console.error('PUT /users/:id/profile error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SAVED PROGRAMS
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/users/:id/saved-programs ────────────────────────────────────────
router.get('/:id/saved-programs', authenticateToken, isSelf, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, sp.saved_at
       FROM saved_programs sp
       JOIN programs p ON sp.program_id = p.id
       WHERE sp.user_id = $1
       ORDER BY sp.saved_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET saved-programs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch saved programs' });
  }
});

// ── POST /api/users/:id/saved-programs/:programId ────────────────────────────
router.post('/:id/saved-programs/:programId', authenticateToken, isSelf, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO saved_programs (user_id, program_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, program_id) DO NOTHING`,
      [req.params.id, req.params.programId]
    );
    res.status(201).json({ message: 'Program saved' });
  } catch (err) {
    console.error('POST saved-programs error:', err.message);
    res.status(500).json({ error: 'Failed to save program' });
  }
});

// ── DELETE /api/users/:id/saved-programs/:programId ──────────────────────────
router.delete('/:id/saved-programs/:programId', authenticateToken, isSelf, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM saved_programs WHERE user_id=$1 AND program_id=$2 RETURNING id`,
      [req.params.id, req.params.programId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Saved program not found' });
    }
    res.json({ message: 'Program removed from saved' });
  } catch (err) {
    console.error('DELETE saved-programs error:', err.message);
    res.status(500).json({ error: 'Failed to remove saved program' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SAVED SCHOLARSHIPS
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/users/:id/saved-scholarships ────────────────────────────────────
router.get('/:id/saved-scholarships', authenticateToken, isSelf, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, ss.saved_at
       FROM saved_scholarships ss
       JOIN scholarships s ON ss.scholarship_id = s.id
       WHERE ss.user_id = $1
       ORDER BY ss.saved_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET saved-scholarships error:', err.message);
    res.status(500).json({ error: 'Failed to fetch saved scholarships' });
  }
});

// ── POST /api/users/:id/saved-scholarships/:scholarshipId ────────────────────
router.post('/:id/saved-scholarships/:scholarshipId', authenticateToken, isSelf, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO saved_scholarships (user_id, scholarship_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, scholarship_id) DO NOTHING`,
      [req.params.id, req.params.scholarshipId]
    );
    res.status(201).json({ message: 'Scholarship saved' });
  } catch (err) {
    console.error('POST saved-scholarships error:', err.message);
    res.status(500).json({ error: 'Failed to save scholarship' });
  }
});

// ── DELETE /api/users/:id/saved-scholarships/:scholarshipId ──────────────────
router.delete('/:id/saved-scholarships/:scholarshipId', authenticateToken, isSelf, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM saved_scholarships WHERE user_id=$1 AND scholarship_id=$2 RETURNING id`,
      [req.params.id, req.params.scholarshipId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Saved scholarship not found' });
    }
    res.json({ message: 'Scholarship removed from saved' });
  } catch (err) {
    console.error('DELETE saved-scholarships error:', err.message);
    res.status(500).json({ error: 'Failed to remove saved scholarship' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// APPLICATIONS  (deadlines are derived from this table — no separate table)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/users/:id/applications ──────────────────────────────────────────
router.get('/:id/applications', authenticateToken, isSelf, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET applications error:', err.message);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// ── POST /api/users/:id/applications ─────────────────────────────────────────
router.post('/:id/applications', authenticateToken, isSelf, async (req, res) => {
  const { program_id, university, program_name, country, deadline, status } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO applications (user_id, program_id, university, program_name, country, deadline, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [req.params.id, program_id || null, university, program_name, country, deadline, status || 'pending']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST applications error:', err.message);
    res.status(500).json({ error: 'Failed to create application' });
  }
});

// ── PUT /api/users/:id/applications/:appId ───────────────────────────────────
router.put('/:id/applications/:appId', authenticateToken, isSelf, async (req, res) => {
  const { status, university, program_name, country, deadline } = req.body;

  try {
    const result = await pool.query(
      `UPDATE applications
       SET status=$1, university=$2, program_name=$3, country=$4, deadline=$5
       WHERE id=$6 AND user_id=$7
       RETURNING *`,
      [status, university, program_name, country, deadline, req.params.appId, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT applications/:appId error:', err.message);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// ── DELETE /api/users/:id/applications/:appId ─────────────────────────────────
router.delete('/:id/applications/:appId', authenticateToken, isSelf, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM applications WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.appId, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }
    res.json({ message: 'Application deleted' });
  } catch (err) {
    console.error('DELETE applications/:appId error:', err.message);
    res.status(500).json({ error: 'Failed to delete application' });
  }
});

module.exports = router;
