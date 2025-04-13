// 라우터 - URL 경로 매핑 및 요청 검증 담당

import { Router } from 'express';
import passport from 'passport';
import { 
    crawlAlbamonController,
    processBusinessContacts,
    batchProcessJobIds,
    getCustomersWithContacts
} from '../controllers/albamonController.js';
import { createLogger } from '../lib/logger.js';

const router = Router();
const logger = createLogger('AlbamonRoutes');
const authenticateJWT = passport.authenticate('jwt', { session: false });

// 비동기 핸들러를 위한 래퍼 함수
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 크롤링 라우터
router.post('/crawl-search', authenticateJWT, asyncHandler(async (req, res) => {
  logger.debug('/crawl-search 라우트 접근됨');
  logger.debug(`요청 본문: ${JSON.stringify(req.body)}`);
  
  // 요청 유효성 검사
  if (!req.body.urls || !Array.isArray(req.body.urls)) {
    return res.status(400).json({
      success: false,
      message: "올바른 요청 형식이 아닙니다. 'urls' 배열이 필요합니다."
    });
  }
  
  return await crawlAlbamonController(req, res);
}));


// 연락처 정보 크롤링 및 저장 라우터
router.post('/contact', authenticateJWT, asyncHandler(async (req, res) => {
  logger.debug('/contact 라우트 접근됨');
  logger.debug(`요청 본문: ${JSON.stringify(req.body)}`);
  return await processBusinessContacts(req, res);
}));

router.get('/data', authenticateJWT, asyncHandler(getCustomersWithContacts));

export default router;