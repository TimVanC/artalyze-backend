// authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.authenticateToken = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded JWT:', decoded); // Log decoded token
    req.user = { userId: decoded.userId }; // Attach userId
    next();
  } catch (error) {
    console.error('JWT verification failed:', error);
    res.status(401).json({ message: 'Unauthorized access' });
  }
};

// Middleware to check if the user is an admin
exports.authorizeAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next(); // User is admin, continue
  } else if (!req.user) {
    return res.status(401).json({ message: 'Authentication required.' });
  } else {
    res.status(403).json({ message: 'Access denied. Admins only.' });
  }
};
