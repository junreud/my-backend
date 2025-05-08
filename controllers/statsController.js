import dayjs from 'dayjs';
import { Op } from 'sequelize';
import User from '../models/User.js';
import CustomerInfo from '../models/CustomerInfo.js';

export async function getDailySummary(req, res) {
  try {
    const todayStart = dayjs().startOf('day').toDate();
    const tomorrowStart = dayjs().add(1, 'day').startOf('day').toDate();

    const todayUsersCount = await User.count({
      where: { created_at: { [Op.gte]: todayStart, [Op.lt]: tomorrowStart } }
    });

    const newClientsCount = await CustomerInfo.count({
      where: { created_at: { [Op.gte]: todayStart, [Op.lt]: tomorrowStart } }
    });

    return res.json({
      success: true,
      todayUsers: { count: todayUsersCount, description: `${todayUsersCount}명` },
      newClients: { count: newClientsCount, description: `${newClientsCount}명` }
    });
  } catch (err) {
    console.error('[ERROR] getDailySummary:', err);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
}
 