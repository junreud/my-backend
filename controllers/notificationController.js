import Notification from '../models/Notification.js';

// Create a new notification
export const createNotification = async (req, res) => {
  try {
    const { userId, message, type, data } = req.body;
    const notification = await Notification.create({ userId, message, type, data });
    // real-time push via Socket.IO
    const io = req.app.get('socketio');
    io.to(`user_${notification.userId}`).emit('notification', notification);
    res.status(201).json(notification);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
};

// Delete (soft) a notification
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOne({ where: { id, userId: req.user.id } });
    if (!notification) return res.status(404).json({ error: 'Not found' });
    notification.isDeleted = true;
    await notification.save();
    return res.sendStatus(204);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete notification' });
  }
};

export const getNotifications = async (req, res) => {
  try {
    const { unread } = req.query;
    const where = { userId: req.user.id, isDeleted: false };
    if (unread === 'true') where.isRead = false;
    const notifications = await Notification.findAll({ where, order: [['createdAt', 'DESC']] });
    res.json(notifications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// Mark a notification as read
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOne({ where: { id, userId: req.user.id } });
    if (!notification) return res.status(404).json({ error: 'Not found' });
    notification.isRead = true;
    await notification.save();
    res.json(notification);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to mark read' });
  }
};
