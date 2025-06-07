import Notification from '../models/Notification.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('NotificationController');

// Create a new notification
export const createNotification = async (req) => {
  const { handleDbOperation, logger: controllerLogger, validateRequiredFields } = createControllerHelper({
    controllerName: 'NotificationController',
    actionName: 'createNotification',
    defaultErrMessage: '알림 생성에 실패했습니다.'
  });

  try {
    validateRequiredFields(req.body, ['userId', 'message', 'type']);
    const { userId, message, type, data } = req.body;

    const notification = await handleDbOperation(
      Notification.create({ userId, message, type, data }),
      { operationName: 'CreateNotificationInDB' }
    );

    // real-time push via Socket.IO
    const io = req.app.get('socketio');
    if (io) {
      io.to(`user_${notification.userId}`).emit('notification', notification);
      controllerLogger.debug('Notification emitted via Socket.IO', { userId: notification.userId });
    } else {
      controllerLogger.warn('Socket.IO instance not found, skipping real-time push.');
    }

    return notification; // Return data
  } catch (error) {
    controllerLogger.error('Error creating notification:', error);
    // Throw error instead of sending response
    throw error;
  }
};

// Delete (soft) a notification
export const deleteNotification = async (req) => {
  const { handleDbOperation, logger: controllerLogger, validateRequiredFields } = createControllerHelper({
    controllerName: 'NotificationController',
    actionName: 'deleteNotification',
    defaultErrMessage: '알림 삭제에 실패했습니다.'
  });

  try {
    validateRequiredFields(req.params, ['id']);
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await handleDbOperation(
      Notification.findOne({ where: { id, userId } }),
      { operationName: 'FindNotificationForDelete', suppressNotFoundError: true }
    );

    if (!notification) {
      // Throw a custom error or a generic one that sendError can interpret
      const notFoundError = new Error('알림을 찾을 수 없습니다.');
      notFoundError.statusCode = 404;
      throw notFoundError;
    }
    if (notification.isDeleted) {
      controllerLogger.info('Notification already soft-deleted', { id });
      return { alreadyDeleted: true }; // Indicate already deleted
    }

    notification.isDeleted = true;
    await handleDbOperation(
      notification.save(),
      { operationName: 'SoftDeleteNotification' }
    );

    return { success: true }; // Indicate successful deletion
  } catch (error) {
    controllerLogger.error('Error deleting notification:', error);
    throw error; // Rethrow error
  }
};

export const getNotifications = async (req) => {
  const { handleDbOperation, logger: controllerLogger } = createControllerHelper({
    controllerName: 'NotificationController',
    actionName: 'getNotifications',
    defaultErrMessage: '알림 조회에 실패했습니다.'
  });

  try {
    const { unread } = req.query;
    const where = { userId: req.user.id, isDeleted: false };
    if (unread === 'true') where.isRead = false;

    controllerLogger.debug('Fetching notifications with criteria', { where });
    const notifications = await handleDbOperation(
      () => Notification.findAll({ where, order: [['createdAt', 'DESC']] }), // Wrapped in a function
      { operationName: 'FindAllNotifications' }
    );

    return notifications; // Return data
  } catch (error) {
    controllerLogger.error('Error fetching notifications:', error);
    throw error; // Rethrow error
  }
};

// Mark a notification as read
export const markAsRead = async (req) => {
  const { handleDbOperation, logger: controllerLogger, validateRequiredFields } = createControllerHelper({
    controllerName: 'NotificationController',
    actionName: 'markAsRead',
    defaultErrMessage: '알림을 읽음으로 표시하는데 실패했습니다.'
  });

  try {
    validateRequiredFields(req.params, ['id']);
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await handleDbOperation(
      Notification.findOne({ where: { id, userId } }),
      { operationName: 'FindNotificationForMarkAsRead', suppressNotFoundError: true }
    );

    if (!notification) {
      const notFoundError = new Error('알림을 찾을 수 없습니다.');
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    if (notification.isRead) {
      controllerLogger.info('Notification already marked as read', { id });
      return notification; // Already read, return current state
    }

    notification.isRead = true;
    await handleDbOperation(
      notification.save(),
      { operationName: 'MarkNotificationAsRead' }
    );

    return notification; // Return updated notification
  } catch (error) {
    controllerLogger.error('Error marking notification as read:', error);
    throw error; // Rethrow error
  }
};
