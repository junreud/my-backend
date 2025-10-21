// utils/reviewCrawlTracker.js
import { createLogger } from '../lib/logger.js';
import Review from '../models/Review.js';

const logger = createLogger('ReviewCrawlTracker');

// 6시간 = 6 * 60 * 60 * 1000 밀리초
const CRAWL_INTERVAL = 6 * 60 * 60 * 1000;

/**
 * 특정 place_id의 마지막 크롤링 시간을 확인
 * @param {string} placeId - 플레이스 ID
 * @returns {Promise<Date|null>} 마지막 크롤링 시간
 */
export async function getLastCrawlTime(placeId) {
  try {
    const latestReview = await Review.findOne({
      where: { place_id: placeId },
      order: [['created_at', 'DESC']],
      attributes: ['created_at']
    });

    return latestReview ? latestReview.created_at : null;
  } catch (error) {
    logger.error(`플레이스 ${placeId} 마지막 크롤링 시간 조회 실패:`, error.message);
    return null;
  }
}

/**
 * 6시간이 지났는지 확인
 * @param {string} placeId - 플레이스 ID
 * @returns {Promise<boolean>} 크롤링이 필요한지 여부
 */
export async function shouldCrawl(placeId) {
  try {
    const lastCrawlTime = await getLastCrawlTime(placeId);
    
    if (!lastCrawlTime) {
      logger.info(`플레이스 ${placeId} - 첫 크롤링 필요`);
      return true;
    }

    const now = new Date();
    const timeDiff = now.getTime() - lastCrawlTime.getTime();
    const hoursSinceLastCrawl = timeDiff / (1000 * 60 * 60);

    logger.info(`플레이스 ${placeId} - 마지막 크롤링: ${lastCrawlTime}, ${hoursSinceLastCrawl.toFixed(1)}시간 전`);

    return timeDiff >= CRAWL_INTERVAL;
  } catch (error) {
    logger.error(`플레이스 ${placeId} 크롤링 필요 여부 확인 실패:`, error.message);
    return false;
  }
}

/**
 * 자동 크롤링 실행 (6시간 체크 포함)
 * @param {string} placeId - 플레이스 ID
 * @param {string} reviewType - 리뷰 타입 ('receipt' 또는 'blog')
 * @returns {Promise<Object>} 크롤링 결과
 */
export async function autoCrawlIfNeeded(placeId, reviewType = 'receipt') {
  try {
    const needsCrawl = await shouldCrawl(placeId);
    
    if (!needsCrawl) {
      return {
        success: true,
        skipped: true,
        message: '6시간이 지나지 않아 크롤링을 건너뜁니다.',
        lastCrawlTime: await getLastCrawlTime(placeId)
      };
    }

    logger.info(`플레이스 ${placeId} - 자동 크롤링 시작 (${reviewType})`);

    // 실제 크롤링 로직 호출
    const NaverReviewCrawler = (await import('../services/naverReviewCrawler.js')).default;
    const crawler = new NaverReviewCrawler();
    
    const result = await crawler.crawlAndSaveReviews(placeId, {
      sortType: 'latest', // 최신순
      maxPages: 3 // 최대 3페이지만 크롤링
    });

    logger.info(`플레이스 ${placeId} - 자동 크롤링 완료:`, {
      total: result.total,
      saved: result.saved
    });

    return {
      success: true,
      crawled: true,
      result: {
        total: result.total,
        saved: result.saved,
        message: `${result.saved}개의 새로운 리뷰가 수집되었습니다.`
      }
    };

  } catch (error) {
    logger.error(`플레이스 ${placeId} 자동 크롤링 실패:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}
