import express from 'express';
import { analyzeSEO, getSEOResult, crawlReviewsForSEO } from '../controllers/seoController.js';
import { createRouterWithAuth, asyncHandler } from '../middlewares/common.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError } = createRouterWithAuth('seoRoutes');

// JWT 인증 및 요청 로깅 적용
router.use(authAndLog);

/**
 * POST /api/seo/analyze
 * SEO 분석 실행
 */
router.post('/analyze', asyncHandler(async (req, res) => {
  const result = await analyzeSEO(req);
  return sendSuccess(res, result);
}));

/**
 * GET /api/seo/result/:placeId
 * 기존 SEO 분석 결과 조회
 */
router.get('/result/:placeId', asyncHandler(async (req, res) => {
  const result = await getSEOResult(req);
  return sendSuccess(res, result);
}));

/**
 * POST /api/seo/crawl-reviews
 * SEO 최적화를 위한 리뷰 크롤링 (영수증 + 블로그 리뷰)
 */
router.post('/crawl-reviews', asyncHandler(async (req, res) => {
  const result = await crawlReviewsForSEO(req);
  return sendSuccess(res, result);
}));

export default router;
