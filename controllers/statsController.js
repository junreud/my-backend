import dayjs from 'dayjs';
import { Op } from 'sequelize';
import User from '../models/User.js';
import CustomerInfo from '../models/CustomerInfo.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';

const { handleDbOperation, logger } = createControllerHelper('StatsController');

export async function getDailySummary(req) {
  logger.debug('Attempting to fetch daily summary');
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

    logger.info('Successfully fetched daily summary.');
    return result;
  } catch (error) {
    logger.error('Error fetching daily summary:', error);
    const err = new Error('일일 통계 조회 중 서버 오류가 발생했습니다.');
    err.statusCode = 500;
    throw err;
  }
}
