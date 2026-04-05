require('dotenv').config();
const express = require('express');
const cors = require('cors');

// ── Route imports ──────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const programRoutes = require('./routes/programs');
const scholarshipRoutes = require('./routes/scholarships');
const costRoutes = require('./routes/costs');
const userRoutes = require('./routes/users');

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    message: '🎓 EdVoyage API is running',
    version: '1.0.0',
    endpoints: [
      'GET  /api/programs',
      'GET  /api/scholarships',
      'GET  /api/costs',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET  /api/auth/me',
      'PUT  /api/users/:id/profile',
      'GET  /api/users/:id/saved-programs',
      'GET  /api/users/:id/saved-scholarships',
      'GET  /api/users/:id/applications'
    ]
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/scholarships', scholarshipRoutes);
app.use('/api/costs', costRoutes);
app.use('/api/users', userRoutes);

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\nEdVoyage API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/\n`);
});
