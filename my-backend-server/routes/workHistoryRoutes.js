import express from 'express';
import { createRouterWithAuth, asyncHandler } from '../middlewares/common.js';
import { getUserWorkHistoriesHandler } from '../controllers/workHistoryController.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError } = createRouterWithAuth('workHistoryRoutes');

// JWT 인증 및 요청 로깅 적용
router.use(authAndLog);

/**
 * GET /work-history/user/:userId
 * 사용자의 작업 이력 조회
 */
router.get('/user/:userId', asyncHandler(async (req, res) => {
  const result = await getUserWorkHistoriesHandler(req);
  return sendSuccess(res, result);
}));

export default router;
