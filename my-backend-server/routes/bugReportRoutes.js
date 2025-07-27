import express from 'express';
import multer from 'multer';
import { body } from 'express-validator';

// Controllers
import { createBugReport } from '../controllers/bugReportController.js';

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors } from '../middlewares/common.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError, asyncHandler, logger } = createRouterWithAuth('bugReportRoutes');

// 공통 JWT 인증 및 요청 로깅
router.use(authAndLog);
const upload = multer({ dest: 'uploads/bug_screenshots/' });

router.post(
  '/',
  upload.single('screenshot'),
  body('title').notEmpty().withMessage('제목이 필요합니다.'),
  body('category').notEmpty().withMessage('카테고리가 필요합니다.'),
  body('description').notEmpty().withMessage('설명이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('createBugReport 처리 시작');
    const result = await createBugReport(req);
    return sendSuccess(res, result.data, result.message, result.statusCode);
  })
);

export default router;
