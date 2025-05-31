import dayjs from 'dayjs';
import { Op } from 'sequelize';
import User from '../models/User.js';
import CustomerInfo from '../models/CustomerInfo.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';

const { sendSuccess, sendError, handleDbOperation } = createControllerHelper('StatsController');

export async function getDailySummary(req, res) {
  try {
    const result = await handleDbOperation(async () => {
      const todayStart = dayjs().startOf('day').toDate();
      const tomorrowStart = dayjs().add(1, 'day').startOf('day').toDate();

      const [todayUsersCount, newClientsCount] = await Promise.all([
        User.count({
          where: { created_at: { [Op.gte]: todayStart, [Op.lt]: tomorrowStart } }
        }),
        CustomerInfo.count({
          where: { created_at: { [Op.gte]: todayStart, [Op.lt]: tomorrowStart } }
        })
      ]);

      return {
        todayUsers: { count: todayUsersCount, description: `${todayUsersCount}명` },
        newClients: { count: newClientsCount, description: `${newClientsCount}명` }
      };
    }, '일일 통계 조회');

    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, 500, '서버 오류');
  }
}
 