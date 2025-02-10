const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/authMiddleware');

// ✅ Apply authentication middleware
router.get('/theme', authenticateToken, userController.getThemePreference);
router.put('/theme', authenticateToken, userController.updateThemePreference);

module.exports = router;
