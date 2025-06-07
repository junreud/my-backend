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
  body('friends').isArray().withMessage('friends 배열이 필요합니다.'), // Changed from friendIds to friends to match controller
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('add-friends 처리 시작');
    const result = await addFriends(req); // Removed res
    // return sendSuccess(res, result); // Old way
    return sendSuccess(res, result.results); // Correctly pass the data from the controller
  })
);

// 메시지 전송 처리
router.post(
  '/send',
  body('message_groups').isArray().withMessage('message_groups 배열이 필요합니다.'), // Changed from message to message_groups and added isArray validation
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('send 처리 시작');
    const result = await sendMessages(req); // Removed res
    // return sendSuccess(res, result); // Old way
    return sendSuccess(res, result.results); // Correctly pass the data from the controller
  })
);

export default router;