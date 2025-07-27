/**
 * 네이버 리뷰 크롤링 테스트 스크립트
 */
import NaverReviewCrawler from './naverReviewCrawler.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('TestCrawler');

async function testCrawler() {
  const crawler = new NaverReviewCrawler();
  
  try {
    // 테스트용 place_id (사용자가 제공한 예시)
    const testPlaceId = '1333323901';
    
    logger.info('크롤링 테스트 시작', { placeId: testPlaceId });
    
    const result = await crawler.crawlAndSaveReviews(testPlaceId, {
      sortType: 'recommend',
      maxPages: 1
    });
    
    logger.info('크롤링 테스트 완료', result);
    
  } catch (error) {
    logger.error('크롤링 테스트 실패:', error);
    console.error('상세 오류:', error);
  } finally {
    await crawler.closeBrowser();
  }
}

// 직접 실행 시에만 테스트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testCrawler();
}

export default testCrawler;
