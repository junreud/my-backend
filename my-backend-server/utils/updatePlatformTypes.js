// utils/updatePlatformTypes.js
import Review from '../models/Review.js';
import { detectAccuratePlatformType } from './platformDetector.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('UpdatePlatformTypes');

/**
 * 기존 블로그 리뷰들의 플랫폼 타입을 재분석하여 업데이트
 * @param {number} limit - 한 번에 처리할 리뷰 수 (기본값: 100)
 */
export async function updateBlogReviewPlatformTypes(limit = 100) {
  try {
    logger.info('블로그 리뷰 플랫폼 타입 일괄 업데이트 시작...');
    
    // 블로그 타입 리뷰 중 platform_type이 설정되지 않은 것들 조회
    const reviews = await Review.findAll({
      where: {
        review_type: 'blog',
        // platform_type이 null이거나 'other'인 것들
        $or: [
          { platform_type: null },
          { platform_type: 'other' }
        ]
      },
      limit,
      order: [['created_at', 'DESC']]
    });
    
    if (reviews.length === 0) {
      logger.info('업데이트할 리뷰가 없습니다.');
      return { updated: 0, blog: 0, cafe: 0, other: 0 };
    }
    
    logger.info(`${reviews.length}개 리뷰 플랫폼 타입 분석 시작...`);
    
    const results = {
      updated: 0,
      blog: 0,
      cafe: 0,
      other: 0
    };
    
    for (const review of reviews) {
      try {
        const newPlatformType = detectAccuratePlatformType(
          review.title,
          review.content,
          review.author,
          review.url
        );
        
        // 기존 타입과 다른 경우에만 업데이트
        if (review.platform_type !== newPlatformType) {
          await review.update({ platform_type: newPlatformType });
          results.updated++;
          results[newPlatformType]++;
          
          logger.info(`리뷰 ${review.id} 플랫폼 타입 업데이트: ${review.platform_type} → ${newPlatformType}`, {
            title: review.title?.substring(0, 30),
            author: review.author,
            url: review.url?.substring(0, 50)
          });
        }
      } catch (error) {
        logger.error(`리뷰 ${review.id} 플랫폼 타입 업데이트 실패:`, error.message);
      }
    }
    
    logger.info('블로그 리뷰 플랫폼 타입 일괄 업데이트 완료:', results);
    return results;
    
  } catch (error) {
    logger.error('블로그 리뷰 플랫폼 타입 일괄 업데이트 중 오류:', error);
    throw error;
  }
}

/**
 * 모든 블로그 리뷰의 플랫폼 타입을 재분석 (페이지네이션 방식)
 */
export async function updateAllBlogReviewPlatformTypes() {
  let totalUpdated = 0;
  let totalResults = { updated: 0, blog: 0, cafe: 0, other: 0 };
  let hasMore = true;
  
  while (hasMore) {
    const results = await updateBlogReviewPlatformTypes(100);
    
    totalUpdated += results.updated;
    totalResults.updated += results.updated;
    totalResults.blog += results.blog;
    totalResults.cafe += results.cafe;
    totalResults.other += results.other;
    
    hasMore = results.updated > 0;
    
    if (hasMore) {
      logger.info(`진행상황: ${totalUpdated}개 업데이트 완료, 계속 처리 중...`);
      // 잠시 대기하여 DB 부하 방지
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  logger.info(`전체 블로그 리뷰 플랫폼 타입 업데이트 완료: 총 ${totalUpdated}개 업데이트`, totalResults);
  return totalResults;
}
