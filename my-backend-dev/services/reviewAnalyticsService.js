// services/reviewAnalyticsService.js
import { Op } from 'sequelize';
import PlaceDetailResult from '../models/PlaceDetailResult.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('ReviewAnalyticsService');

/**
 * 어제와 오늘의 리뷰 수 변화량을 계산
 * @param {string|number} placeId - 업체 ID
 * @returns {Promise<Object>} 변화량 정보
 */
export async function getReviewCountChanges(placeId) {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // 날짜 범위 설정 (시간 제외)
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    
    const yesterdayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setDate(yesterdayEnd.getDate() + 1);
    
    logger.info(`리뷰 변화량 조회 - 업체 ID: ${placeId}`);
    logger.info(`어제 범위: ${yesterdayStart.toISOString()} ~ ${yesterdayEnd.toISOString()}`);
    logger.info(`오늘 범위: ${todayStart.toISOString()} ~ ${todayEnd.toISOString()}`);
    
    // 어제 데이터 조회
    const yesterdayData = await PlaceDetailResult.findOne({
      where: {
        place_id: placeId,
        created_at: {
          [Op.gte]: yesterdayStart,
          [Op.lt]: yesterdayEnd
        }
      },
      order: [['created_at', 'DESC']]
    });
    
    // 오늘 데이터 조회
    const todayData = await PlaceDetailResult.findOne({
      where: {
        place_id: placeId,
        created_at: {
          [Op.gte]: todayStart,
          [Op.lt]: todayEnd
        }
      },
      order: [['created_at', 'DESC']]
    });
    
    // 가장 최근 데이터 조회 (현재 수치용)
    const currentData = await PlaceDetailResult.findOne({
      where: {
        place_id: placeId
      },
      order: [['created_at', 'DESC']]
    });
    
    logger.info(`어제 데이터: ${yesterdayData ? 'Found' : 'Not found'}`);
    logger.info(`오늘 데이터: ${todayData ? 'Found' : 'Not found'}`);
    logger.info(`최근 데이터: ${currentData ? 'Found' : 'Not found'}`);
    
    if (!currentData) {
      return {
        success: false,
        message: '해당 업체의 리뷰 데이터가 없습니다.'
      };
    }
    
    // 변화량 계산
    const currentBlogCount = currentData.blog_review_count || 0;
    const currentReceiptCount = currentData.receipt_review_count || 0;
    
    let blogChange = 0;
    let receiptChange = 0;
    
    // 비교 기준 결정 (오늘 데이터가 있으면 어제와 비교, 없으면 이전 데이터와 비교)
    const comparisonData = todayData && yesterdayData ? yesterdayData : 
                          (yesterdayData || await getRecentPreviousData(placeId, currentData.created_at));
    
    if (comparisonData) {
      const previousBlogCount = comparisonData.blog_review_count || 0;
      const previousReceiptCount = comparisonData.receipt_review_count || 0;
      
      blogChange = currentBlogCount - previousBlogCount;
      receiptChange = currentReceiptCount - previousReceiptCount;
      
      logger.info(`변화량 계산 완료:`);
      logger.info(`- 블로그: ${previousBlogCount} → ${currentBlogCount} (${blogChange >= 0 ? '+' : ''}${blogChange})`);
      logger.info(`- 영수증: ${previousReceiptCount} → ${currentReceiptCount} (${receiptChange >= 0 ? '+' : ''}${receiptChange})`);
    }
    
    return {
      success: true,
      data: {
        current: {
          blogReviewCount: currentBlogCount,
          receiptReviewCount: currentReceiptCount,
          lastUpdated: currentData.created_at
        },
        changes: {
          blogChange,
          receiptChange,
          comparisonDate: comparisonData?.created_at || null
        },
        total: currentBlogCount + currentReceiptCount,
        totalChange: blogChange + receiptChange
      }
    };
    
  } catch (error) {
    logger.error('리뷰 변화량 조회 실패:', error);
    return {
      success: false,
      message: '리뷰 변화량 조회 중 오류가 발생했습니다.',
      error: error.message
    };
  }
}

/**
 * 특정 날짜 이전의 가장 최근 데이터 조회
 * @param {string|number} placeId - 업체 ID
 * @param {Date} currentDate - 기준 날짜
 * @returns {Promise<Object|null>} 이전 데이터
 */
async function getRecentPreviousData(placeId, currentDate) {
  try {
    return await PlaceDetailResult.findOne({
      where: {
        place_id: placeId,
        created_at: {
          [Op.lt]: currentDate
        }
      },
      order: [['created_at', 'DESC']]
    });
  } catch (error) {
    logger.error('이전 데이터 조회 실패:', error);
    return null;
  }
}

/**
 * 여러 업체의 리뷰 변화량을 한번에 조회
 * @param {Array<string|number>} placeIds - 업체 ID 배열
 * @returns {Promise<Object>} 업체별 변화량 정보
 */
export async function getBatchReviewCountChanges(placeIds) {
  try {
    logger.info(`일괄 리뷰 변화량 조회 - ${placeIds.length}개 업체`);
    
    const results = {};
    
    // 병렬 처리로 성능 개선
    const promises = placeIds.map(async (placeId) => {
      const result = await getReviewCountChanges(placeId);
      results[placeId] = result;
    });
    
    await Promise.all(promises);
    
    return {
      success: true,
      data: results
    };
    
  } catch (error) {
    logger.error('일괄 리뷰 변화량 조회 실패:', error);
    return {
      success: false,
      message: '일괄 리뷰 변화량 조회 중 오류가 발생했습니다.',
      error: error.message
    };
  }
}
