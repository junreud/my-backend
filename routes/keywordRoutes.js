/**
 * routes/keywordRoutes.js
 */
import express from 'express';
import keywordController from '../controllers/keywordController.js';

const router = express.Router();

router.get('/analysis', keywordController.getFinalKeywords);
// router.get('/keyword/parallel-sse', getParallelSSE);
module.exports = router;
