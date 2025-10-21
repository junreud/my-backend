import express from 'express';
import { query, body } from 'express-validator';

// Controllers
import { getUserPlaces, checkPlace, createPlace, toggleFavorite, getNaverPlaceInfo, getReviewChanges, getBatchReviewChanges } from '../controllers/placeController.js';

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
  query('platform').optional().isIn(['naver','instagram','facebook']),
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

// Toggle favorite status
router.post(
  '/favorite',
  body('userId').isInt().toInt(),
  body('place_id').notEmpty(),
  body('is_favorite').isBoolean(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await toggleFavorite(req);
    return sendSuccess(res, result);
  })
);

// Get Naver place information
router.get(
  '/:placeId/naver-info',
  asyncHandler(async (req, res) => {
    const result = await getNaverPlaceInfo(req);
    return sendSuccess(res, result);
  })
);

// Get review count changes for a place
router.get(
  '/:placeId/review-changes',
  asyncHandler(async (req, res) => {
    const result = await getReviewChanges(req);
    return sendSuccess(res, result, '리뷰 변화량 조회 완료');
  })
);

// Get review count changes for multiple places
router.post(
  '/batch-review-changes',
  body('placeIds').isArray().withMessage('placeIds는 배열이어야 합니다'),
  body('placeIds.*').notEmpty().withMessage('각 placeId는 비어있을 수 없습니다'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await getBatchReviewChanges(req);
    return sendSuccess(res, result, '일괄 리뷰 변화량 조회 완료');
  })
);

export default router;
