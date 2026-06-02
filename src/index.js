require('dotenv').config();
const express = require('express');
const cors = require('cors');

// ── Route imports ──────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const programRoutes = require('./routes/programs');
const scholarshipRoutes = require('./routes/scholarships');
const costRoutes = require('./routes/costs');
const userRoutes = require('./routes/users');
const visaRoutes = require('./routes/visa');

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isLocalhost = /^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
    if (allowedOrigins.includes(origin) || isLocalhost) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
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
      'GET  /api/visa',
      'GET  /api/visa/:country',
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
app.use('/api/visa', visaRoutes);

// ── Chat Proxy ────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId, email, name, ...profile } = req.body;
    const webhookUrl = process.env.N8N_CHAT_WEBHOOK_URL || 'http://localhost:5678/webhook/edvoyage-chat';

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        userId,
        email,
        name,
        ...profile
      })
    });

    if (!response.ok) {
      console.error(`n8n webhook error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ error: 'Failed to communicate with AI chat agent' });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Chat proxy error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
