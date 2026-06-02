const express = require('express');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const toNullableNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

// ── Guard: ensure the requesting user can only access their own data ───────────
const isSelf = (req, res, next) => {
  if (req.user.id !== req.params.id && !req.user.is_admin) {
    return res.status(403).json({ error: 'Forbidden — you can only access your own data' });
  }
  next();
};

// ── GET /api/users/admin/stats ────────────────────────────────────────────────
router.get('/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total_users,
         COUNT(*) FILTER (WHERE is_admin = true)::int AS admin_users,
         COUNT(*) FILTER (WHERE is_admin = false)::int AS student_users
       FROM users`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /users/admin/stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user stats' });
  }
});

// ── GET /api/users/admin/growth ───────────────────────────────────────────────
// Cumulative user count per day (UTC), last 30 days — for admin dashboard chart.
router.get('/admin/growth', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `WITH days AS (
         SELECT generate_series(
           ((NOW() AT TIME ZONE 'utc')::date - INTERVAL '29 days'),
           (NOW() AT TIME ZONE 'utc')::date,
           INTERVAL '1 day'
         )::date AS day
       )
       SELECT d.day::text AS day,
              (
                SELECT COUNT(*)::int
                FROM users u
                WHERE (u.created_at AT TIME ZONE 'utc')::date <= d.day
              ) AS total
       FROM days d
       ORDER BY d.day ASC`
    );
    res.json({
      points: result.rows.map((row) => ({
        day: row.day,
        total: Number(row.total) || 0
      }))
    });
  } catch (err) {
    console.error('GET /users/admin/growth error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user growth' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/users/:id/profile ────────────────────────────────────────────────
router.get('/:id/profile', authenticateToken, isSelf, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.is_admin, u.created_at,
              up.degree_level, up.major, up.gpa, up.english_test, up.english_score,
              up.target_countries, up.intake_term, up.budget_min, up.budget_max,
              up.budget_currency, up.career_goal
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /users/:id/profile error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── PUT /api/users/:id/profile ────────────────────────────────────────────────
router.put('/:id/profile', authenticateToken, isSelf, async (req, res) => {
  const {
    full_name, phone, degree_level, major, gpa, english_test, english_score,
    target_countries, intake_term, budget_min, budget_max, budget_currency, career_goal
  } = req.body;

  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [req.params.id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profileExists = await pool.query('SELECT 1 FROM user_profiles WHERE user_id = $1', [req.params.id]);
    const isNewSetup = profileExists.rows.length === 0;

    await pool.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone)
       WHERE id = $3`,
      [full_name ?? null, phone ?? null, req.params.id]
    );

    await pool.query(
      `INSERT INTO user_profiles (
         user_id, degree_level, major, gpa, english_test, english_score,
         intake_term, budget_min, budget_max, budget_currency, career_goal, target_countries
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id) DO UPDATE SET
         degree_level = EXCLUDED.degree_level,
         major = EXCLUDED.major,
         gpa = EXCLUDED.gpa,
         english_test = EXCLUDED.english_test,
         english_score = EXCLUDED.english_score,
         intake_term = EXCLUDED.intake_term,
         budget_min = EXCLUDED.budget_min,
         budget_max = EXCLUDED.budget_max,
         budget_currency = EXCLUDED.budget_currency,
         career_goal = EXCLUDED.career_goal,
         target_countries = EXCLUDED.target_countries`,
      [
        req.params.id,
        degree_level ?? null,
        major ?? null,
        toNullableNumber(gpa),
        english_test ?? null,
        toNullableNumber(english_score),
        intake_term ?? null,
        toNullableNumber(budget_min),
        toNullableNumber(budget_max),
        budget_currency || 'USD',
        career_goal ?? null,
        JSON.stringify(Array.isArray(target_countries) ? target_countries : [])
      ]
    );

    // Delete all program matches for the user upon changes
    await pool.query('DELETE FROM program_matches WHERE student_id = $1', [req.params.id]);

    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.is_admin, u.created_at,
              up.degree_level, up.major, up.gpa, up.english_test, up.english_score,
              up.target_countries, up.intake_term, up.budget_min, up.budget_max,
              up.budget_currency, up.career_goal
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    // Trigger profile-submitted webhook (runs on both setup and subsequent edits/updates)
    const submitWebhookUrl = process.env.PROFILE_SUBMITTED_WEBHOOK_URL;
    console.log(`[PROFILE SUBMIT] User ID: ${req.params.id}. Webhook URL: ${submitWebhookUrl || 'not configured'}`);
    if (submitWebhookUrl) {
      console.log(`[PROFILE SUBMIT] Triggering webhook POST to: ${submitWebhookUrl}...`);
      try {
        fetch(submitWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: req.params.id })
        })
        .then(res => {
          console.log(`[PROFILE SUBMIT] Webhook successfully triggered. Status: ${res.status}`);
        })
        .catch(err => {
          console.error('[PROFILE SUBMIT] Webhook network error:', err.message);
        });
      } catch (err) {
        console.error('[PROFILE SUBMIT] Failed to trigger profile-submitted webhook:', err.message);
      }
    }



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
      `SELECT p.*, u.name AS university, c.name AS city, co.name AS country, sp.saved_at
       FROM saved_programs sp
       JOIN programs p ON sp.program_id = p.id
       JOIN universities u ON u.id = p.university_id
       JOIN cities c ON c.id = u.city_id
       JOIN countries co ON co.id = c.country_id
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
      `DELETE FROM saved_programs WHERE user_id=$1 AND program_id=$2 RETURNING program_id`,
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
      `SELECT s.*, co.name AS country, ss.saved_at
       FROM saved_scholarships ss
       JOIN scholarships s ON ss.scholarship_id = s.id
       LEFT JOIN countries co ON co.id = s.country_id
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
      `DELETE FROM saved_scholarships WHERE user_id=$1 AND scholarship_id=$2 RETURNING scholarship_id`,
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
      `SELECT a.*, p.name AS program_name, p.deadline, u.name AS university, co.name AS country
       FROM applications a
       JOIN programs p ON p.id = a.program_id
       JOIN universities u ON u.id = p.university_id
       JOIN cities c ON c.id = u.city_id
       JOIN countries co ON co.id = c.country_id
       WHERE a.user_id = $1
       ORDER BY a.applied_at DESC`,
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
  const { program_id, status } = req.body;
  if (!program_id) return res.status(400).json({ error: 'program_id is required' });

  try {
    const result = await pool.query(
      `INSERT INTO applications (user_id, program_id, status)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [req.params.id, program_id, status || 'pending']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST applications error:', err.message);
    res.status(500).json({ error: 'Failed to create application' });
  }
});

// ── PUT /api/users/:id/applications/:appId ───────────────────────────────────
router.put('/:id/applications/:appId', authenticateToken, isSelf, async (req, res) => {
  const { status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE applications
       SET status=$1
       WHERE id=$2 AND user_id=$3
       RETURNING *`,
      [status, req.params.appId, req.params.id]
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
