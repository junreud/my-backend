// scripts/brandingBlogScheduler.js
import cron from 'node-cron';
import { createLogger } from '../lib/logger.js';
import { runScheduledSearches } from '../services/naverSearchMonitor.js';

const logger = createLogger('BrandingBlogScheduler');

/**
 * 브랜딩 블로그 검색 스케줄러 시작
 */
export function startBrandingBlogScheduler() {
  logger.info('� 브랜딩 블로그 검색 스케줄러 시작');
  
  // 10분마다 실행 (네이버 검색 차단 방지를 위해 적절한 간격)
  cron.schedule('*/10 * * * *', async () => {
    try {
      logger.info('⏰ 브랜딩 블로그 검색 스케줄 실행');
      const results = await runScheduledSearches();
      
      if (results.total > 0) {
        logger.info(`✅ 브랜딩 블로그 검색 완료: ${results.success}/${results.total}개 처리`);
        
        // 누락된 포스트가 있으면 알림 로그
        if (results.missed > 0) {
          logger.warn(`⚠️ 노출 누락 포스트 발견: ${results.missed}개`);
        }
        
        // 새로 노출 확인된 포스트가 있으면 알림 로그
        if (results.found > 0) {
          logger.info(`🎉 새로운 노출 확인: ${results.found}개`);
        }
      }
      
    } catch (error) {
      logger.error('브랜딩 블로그 검색 스케줄 오류:', error.message);
    }
  }, {
    timezone: 'Asia/Seoul'
  });
  
  // 1시간마다 통계 로그 출력
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('📊 브랜딩 블로그 검색 스케줄러 정상 동작 중...');
    } catch (error) {
      logger.error('브랜딩 블로그 통계 로그 오류:', error.message);
    }
  }, {
    timezone: 'Asia/Seoul'
  });
  
  logger.info('브랜딩 블로그 스케줄러 등록 완료:');
  logger.info('- 검색 실행: 10분마다');
  logger.info('- 통계 로그: 1시간마다');
}
