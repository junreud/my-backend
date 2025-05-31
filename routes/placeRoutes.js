import express from 'express';
import { query, body } from 'express-validator';

// Controllers
import { getUserPlaces, checkPlace, createPlace } from '../controllers/placeController.js';

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors } from '../middlewares/common.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError, asyncHandler, logger } = createRouterWithAuth('placeRoutes');

// JWT 인증 및 요청 로깅 적용
router.use(authAndLog);

// Get places associated with a user
router.get(
  '/',
  query('userId').isInt().toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('getUserPlaces 호출');
    const data = await getUserPlaces(req, res);
    return sendSuccess(res, data);
  })
);

// Check if place exists for user
router.post(
  '/check',
  body('userId').isInt().toInt(),
  body('placeId').isInt().toInt(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await checkPlace(req, res);
    return sendSuccess(res, data);
  })
);

// Create a new place
router.post(
  '/create',
  body('userId').isInt().toInt(),
  body('place_name').notEmpty(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await createPlace(req, res);
    return sendSuccess(res, data, 'Place created', 201);
  })
);

export default router;
