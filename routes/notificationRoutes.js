import express from 'express';
import { param, query, body, validationResult } from 'express-validator';

// Controllers
import {
  createNotification,
  getNotifications,
  markAsRead,
  deleteNotification,
} from '../controllers/notificationController.js';

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors, asyncHandler } from '../middlewares/common.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError, logger } = createRouterWithAuth('notificationRoutes');

// JWT 인증 및 요청 로깅 적용
router.use(authAndLog);

// GET /api/notifications?unread=true
router.get(
  '/',
  query('unread').optional().isBoolean().toBoolean(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const notifications = await getNotifications(req);
    return sendSuccess(res, notifications);
  })
);

// POST /api/notifications
router.post(
  '/',
  body('userId').isInt().toInt(),
  body('message').notEmpty(),
  body('type').notEmpty(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const notification = await createNotification(req);
    return sendSuccess(res, notification, '알림이 생성되었습니다.', 201);
  })
);

// PATCH /api/notifications/:id/read
router.patch(
  '/:id/read',
  param('id').isInt().toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const notification = await markAsRead(req);
    return sendSuccess(res, notification, '알림을 읽음으로 표시했습니다.');
  })
);

// DELETE /api/notifications/:id
router.delete(
  '/:id',
  param('id').isInt().toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await deleteNotification(req);
    if (result.alreadyDeleted) {
      return sendSuccess(res, null, '이미 삭제된 알림입니다.', 204);
    }
    return sendSuccess(res, null, '알림이 삭제되었습니다.', 204);
  })
);

export default router;
