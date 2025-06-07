import express from 'express';
import { query, body } from 'express-validator';

// Controllers
import { getUserPlaces, checkPlace, createPlace } from '../controllers/placeController.js';

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors, asyncHandler } from '../middlewares/common.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError } = createRouterWithAuth('placeRoutes');

// JWT 인증 및 요청 로깅 적용
router.use(authAndLog);

// Get places associated with a user
router.get(
  '/',
  query('userId').isInt().toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const places = await getUserPlaces(req);
    return sendSuccess(res, places);
  })
);

// Check if place exists for user
router.post(
  '/check',
  body('userId').isInt().toInt(),
  body('place_id').isInt().toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await checkPlace(req);
    return sendSuccess(res, result);
  })
);

// Create a new place
router.post(
  '/create',
  body('userId').isInt().toInt(),
  body('place_name').notEmpty(),
  body('url').isURL(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const newPlace = await createPlace(req);
    return sendSuccess(res, newPlace, '장소가 생성되었습니다.', 201);
  })
);

export default router;
