import { Router } from 'express';
import { body, param } from 'express-validator';

// Controllers & Services
import {
     crawlAlbamonController,
     processBusinessContacts,
     getCustomersWithContacts
 } from '../controllers/albamonController.js';
import { updateFavorite, updateBlacklist } from '../controllers/contactController.js';

// Models
import CustomerInfo from '../models/CustomerInfo.js';

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors } from '../middlewares/common.js';

const router = Router();
const { authAndLog, sendSuccess, sendError, asyncHandler, logger } = createRouterWithAuth('albamonRoutes');

// 공통 JWT 인증 및 요청 로깅
router.use(authAndLog);

// 크롤링 라우터
router.post(
  '/crawl-search',
  body('urls').isArray().withMessage('urls 배열이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res, next) => {
    logger.debug('crawl-search 처리 시작');
    const result = await crawlAlbamonController(req);
    return sendSuccess(res, result.data, result.message);
  })
);

// 연락처 정보 크롤링 및 저장 라우터
router.post(
  '/contact',
  asyncHandler(async (req, res, next) => {
    logger.debug('contact 처리 시작');
    const result = await processBusinessContacts(req);
    return sendSuccess(res, result.data, result.message);
  })
);

router.get(
  '/data',
  asyncHandler(async (req, res, next) => {
    const data = await getCustomersWithContacts(req);
    return sendSuccess(res, data);
  })
);

// 고객 정보 삭제 라우터 추가
router.delete(
  '/delete/:id',
  param('id').isInt().withMessage('유효한 ID가 필요합니다.').toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const deletedCount = await CustomerInfo.destroy({ where: { id } });
    if (deletedCount === 0) {
      const error = new Error('고객 정보를 찾을 수 없습니다.');
      error.statusCode = 404;
      throw error;
    }
    return sendSuccess(res, {}, '고객 정보가 삭제되었습니다.');
  })
);

// 연락처 즐겨찾기 상태 업데이트
router.patch(
  '/contacts/:contactId/favorite',
  param('contactId').isInt().withMessage('유효한 contactId가 필요합니다.'),
  body('favorite').isBoolean().withMessage('favorite boolean이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res, next) => {
    const result = await updateFavorite(req); 
    return sendSuccess(res, result.data, result.message);
  })
);

// 연락처 블랙리스트 상태 업데이트
router.patch(
  '/contacts/:contactId/blacklist',
  param('contactId').isInt().withMessage('유효한 contactId가 필요합니다.'),
  body('blacklist').isBoolean().withMessage('blacklist boolean이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res, next) => {
    const result = await updateBlacklist(req);
    return sendSuccess(res, result.data, result.message);
  })
);

export default router;