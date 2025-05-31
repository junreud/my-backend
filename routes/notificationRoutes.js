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
import { createRouterWithAuth, handleValidationErrors } from '../middlewares/common.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError, asyncHandler, logger } = createRouterWithAuth('notificationRoutes');

// JWT 인증 및 요청 로깅 적용
router.use(authAndLog);

// GET /api/notifications?unread=true
router.get(
  '/',
  query('unread').optional().isBoolean().toBoolean(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('getNotifications 호출');
    const data = await getNotifications(req, res);
    return sendSuccess(res, data);
  })
);

// POST /api/notifications
router.post(
  '/',
  body('title').notEmpty().withMessage('title 필요'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('createNotification 호출');
    const data = await createNotification(req, res);
    return sendSuccess(res, data, '알림 생성 완료', 201);
  })
);

// PATCH /api/notifications/:id/read
router.patch(
  '/:id/read',
  param('id').isInt().toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('markAsRead 호출');
    const data = await markAsRead(req, res);
    return sendSuccess(res, data);
  })
);

// DELETE /api/notifications/:id
router.delete(
  '/:id',
  param('id').isInt().toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('deleteNotification 호출');
    const data = await deleteNotification(req, res);
    return sendSuccess(res, data);
  })
);

export default router;
