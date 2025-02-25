/**
 * routes/keywordRoutes.js
 */
const express = require('express');
const router = express.Router();
const keywordController = require('../controllers/keywordController');

router.get('/final', keywordController.getFinalKeywords);

module.exports = router;
