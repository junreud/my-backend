import express from 'express';
import { body } from 'express-validator';

// Controllers
import { addFriends, sendMessages } from '../controllers/kakaoController.js';

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors } from '../middlewares/common.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError, asyncHandler, logger } = createRouterWithAuth('kakaoRoutes');

// 공통 JWT 인증 및 요청 로깅
router.use(authAndLog);

// 친구추가 처리
router.post(
  '/add-friends',
  body('friendIds').isArray().withMessage('friendIds 배열이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('add-friends 처리 시작');
    const result = await addFriends(req, res);
    return sendSuccess(res, result);
  })
);

// 메시지 전송 처리
router.post(
  '/send',
  body('message').notEmpty().withMessage('message 내용이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('send 처리 시작');
    const result = await sendMessages(req, res);
    return sendSuccess(res, result);
  })
);

export default router;