import dayjs from 'dayjs';
import { Op } from 'sequelize';
import User from '../models/User.js';
import CustomerInfo from '../models/CustomerInfo.js';
import KeywordBasicCrawlResult from '../models/KeywordBasicCrawlResult.js';
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

/**
 * 대시보드용 키워드 순위 변화 데이터 조회
 */
export async function getDashboardRankingData(req, res) {
  const { handleDbOperation, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'StatsController', actionName: 'getDashboardRankingData' });

  try {
    const result = await handleDbOperation(async () => {
      // 최근 14일간의 순위 데이터 조회
      const fourteenDaysAgo = dayjs().subtract(14, 'days').startOf('day').toDate();
      
      // 키워드별 순위 변화 데이터 조회
      const rankingData = await KeywordBasicCrawlResult.findAll({
        where: {
          created_at: {
            [Op.gte]: fourteenDaysAgo
          },
          ranking: {
            [Op.not]: null,
            [Op.lte]: 10 // 상위 10위까지만
          }
        },
        attributes: [
          'keyword_id',
          'ranking',
          'place_name',
          'created_at'
        ],
        order: [['created_at', 'DESC']],
        limit: 500 // 최근 500개 데이터만
      });

      // 날짜별로 그룹화하여 차트 데이터 생성
      const chartData = {};
      const keywordNames = {};
      
      rankingData.forEach(record => {
        const date = dayjs(record.created_at).format('MM-DD');
        const keywordId = record.keyword_id;
        
        if (!chartData[date]) {
          chartData[date] = {};
        }
        
        chartData[date][keywordId] = record.ranking;
        keywordNames[keywordId] = record.place_name || `키워드 ${keywordId}`;
      });

      // 차트용 데이터 형식으로 변환
      const dates = Object.keys(chartData).sort();
      const datasets = {};
      
      Object.keys(keywordNames).forEach(keywordId => {
        datasets[keywordId] = {
          name: keywordNames[keywordId],
          data: dates.map(date => chartData[date][keywordId] || null)
        };
      });

      return {
        dates,
        datasets: Object.values(datasets),
        totalKeywords: Object.keys(keywordNames).length,
        dataRange: {
          start: fourteenDaysAgo,
          end: new Date()
        }
      };
    }, "대시보드 순위 변화 데이터 조회");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('대시보드 순위 변화 데이터 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '순위 변화 데이터 조회 중 오류가 발생했습니다.'
    });
  }
}
