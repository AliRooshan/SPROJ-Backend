const jwt = require('jsonwebtoken');

/**
 * Middleware: verifies the JWT in the Authorization header.
 * On success, attaches req.user = { id, email, is_admin } to the request.
 * On failure, returns 401.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Access denied — no token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, is_admin }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Middleware: ensures the authenticated user is an admin.
 * Must be used AFTER authenticateToken.
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Forbidden — admin access required' });
  }
  next();
};

module.exports = { authenticateToken, requireAdmin };
