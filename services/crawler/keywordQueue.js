// keywordQueue.js
import Queue from 'bull';
import { Op } from 'sequelize';
import Keyword from '../../models/Keyword.js';
import PlaceDetailResult from '../../models/PlaceDetailResult.js';
import '../../models/index.js'; // Sequelize 관계 로드
import { crawlKeywordBasic } from './basicCrawlerService.js';
import { randomDelay } from '../../config/crawler.js';
import { createLogger } from '../../lib/logger.js';
import { crawlDetail as detailCrawlerService} from './detailCrawlerService.js'; // Correct import path

const logger = createLogger('KeywordQueueLogger', { service: 'crawler' });

/* -----------------------------------------------------------------------------------
 * 14:00 조건 헬퍼들 (기존)
 * ----------------------------------------------------------------------------------- */
function shouldBasicCrawlKeyword(basicLastCrawledDate) {
  const now = new Date();
  const today14h = new Date(now);
  today14h.setHours(14, 0, 0, 0);

  // (1) 한 번도 크롤 안 했다면 true
  if (!basicLastCrawledDate) {
    return true;
  }

  const lastCrawled = new Date(basicLastCrawledDate);

  // (2) 지금 시각이 오늘 14:00 이전이라면
  //     "어제 14:00" 이전에 크롤됐으면 오늘 다시 해야 함
  if (now < today14h) {
    // 어제 14:00
    const yesterday14h = new Date(today14h.getTime() - 24 * 60 * 60 * 1000);
    // 어제 14:00 전이라면 -> true
    return lastCrawled < yesterday14h;
  } else {
    // (3) 오늘 14:00 이후라면
    //     마지막 크롤 시각이 오늘 14:00 이전이면 -> 다시 크롤
    return lastCrawled < today14h;
  }
}
/* -----------------------------------------------------------------------------------
 * 큐 생성
 * ----------------------------------------------------------------------------------- */
export const keywordQueue = new Queue('keyword-crawl-queue', {
  redis: {
    host: '127.0.0.1',
    port: 6379
  },
  defaultJobOptions: {
    timeout: 1 * 60 * 1000, // 1분
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 30000 // 실패 시 30초부터 지수적으로 증가
    },
    removeOnComplete: true
  }
});

// 이벤트 핸들러
keywordQueue.on('error', (err) => {
  logger.error(`[ERROR][keyword-crawl-queue] 큐 에러: ${err.message}`);
});
keywordQueue.on('failed', (job, err) => {
  logger.error(`[ERROR][keyword-crawl-queue] 작업 실패: jobId=${job.id}, err=${err.message}`);
});
keywordQueue.on('completed', (job) => {
  logger.info(`[INFO][keyword-crawl-queue] 작업 완료: jobId=${job.id}`);
});
keywordQueue.on('stalled', (job) => {
  logger.warn(`[WARN][keyword-crawl-queue] 작업 멈춤(stalled): jobId=${job.id}`);
});

/* -----------------------------------------------------------------------------------
 * 실제 크롤링 로직: basic / detail 전부에서 사용
 * (batchSize 관련 로직 제거)
 * ----------------------------------------------------------------------------------- */

// (2) detail 크롤링 (placeId만 처리)
async function processDetailCrawl({ placeId }) {
  if (!placeId) {
    logger.error('[processDetailCrawl] placeId가 제공되지 않았습니다');
    return;
  }

  // 단일 place 처리
  logger.info(`[processDetailCrawl] 단일 placeId=${placeId}`);
  await detailCrawlerService({ placeId });
  // await randomDelay(1, 1.4); // 딜레이 증가
  await randomDelay(1.2, 1.6);
}

/* -----------------------------------------------------------------------------------
 * 큐 처리 로직 - 각각 다른 concurrency로 등록
 * ----------------------------------------------------------------------------------- */

/** 
 * autoBasic: 동시성=3
 */
keywordQueue.process('unifiedProcess', 3, async (job) => {
  const { type, data } = job.data;
  logger.info(`[unifiedProcess] 타입=${type} 작업 시작`);

  try {
    switch (type) {
      case 'basic':
        // basic 작업 처리
        const { keywordId } = data;
        logger.info(`[basic] keywordId=${keywordId} 시작`);
        await crawlKeywordBasic(null, keywordId);
        logger.info(`[basic] keywordId=${keywordId} 완료`);
        break;

      case 'detail':
        // 단일 detail 작업 처리
        const { placeId } = data;
        if (!placeId) {
          logger.error('[detail] placeId가 없습니다');
          return;
        }
        await processDetailCrawl({ placeId });
        break;
      
      case 'userBasic':
        // 사용자 지정 키워드(들)에 대한 basic 크롤링
        const { keywords } = data;
        logger.info(`[userBasic] 키워드 ${keywords.length}개 크롤링 시작`);
        
        if (!Array.isArray(keywords) || keywords.length === 0) {
          logger.warn('[userBasic] 유효한 키워드 배열이 아님');
          return;
        }
        
        // 각 키워드를 순회하며 크롤링
        for (let i = 0; i < keywords.length; i++) {
          const keyword = keywords[i];
          try {
            logger.info(`[userBasic] 키워드 "${keyword}" 크롤링 시작 (${i+1}/${keywords.length})`);
            await crawlKeywordBasic(keyword, null);
            logger.info(`[userBasic] 키워드 "${keyword}" 크롤링 완료`);
            
            // 키워드 간 딜레이
            if (i < keywords.length - 1) {
              await randomDelay(2, 3);
            }
          } catch (err) {
            logger.error(`[userBasic] 키워드 "${keyword}" 크롤링 실패: ${err.message}`);
          }
        }
        
        logger.info(`[userBasic] 총 ${keywords.length}개 키워드 크롤링 완료`);
        break;

      case 'userDetail':
        // 다중 detail 작업 처리
        const { placeIds } = data;
        logger.info(`[userDetail] placeIds=${(placeIds || []).length} 시작`);
        
        if (!Array.isArray(placeIds)) {
          logger.warn('[userDetail] placeIds 배열이 아님');
          return;
        }
        
        // 각 place를 순회
        for (let i = 0; i < placeIds.length; i++) {
          const placeId = placeIds[i];
          try {
            await processDetailCrawl({ placeId });
            await randomDelay(1.4, 1.7);
          } catch (err) {
            logger.error(`[userDetail] placeId=${placeId} 실패: ${err.message}`);
          }
        }
        
        logger.info(`[userDetail] 총 ${placeIds.length}개 완료`);
        break;

      default:
        logger.error(`[unifiedProcess] 알 수 없는 작업 타입: ${type}`);
    }
  } catch (err) {
    logger.error(`[unifiedProcess] 타입=${type} 실패: ${err.message}`);
    throw err;
  }
});

/* -----------------------------------------------------------------------------------
 * (E) 14:00 조건 자동 크롤링 (기존)
 * ----------------------------------------------------------------------------------- */
export async function autoCheckAndAddBasicJobs() {
  const keywords = await Keyword.findAll();
  let count = 0;
  for (const kw of keywords) {
    if (shouldBasicCrawlKeyword(kw.basic_last_crawled_date)) {
      // 수정: 통합 프로세서 사용
      await keywordQueue.add('unifiedProcess', { 
        type: 'basic', 
        data: { keywordId: kw.id } 
      }, { priority: 4 });
      count++;
    }
  }
  logger.info(`[autoCheckAndAddBasicJobs] ${count}개 큐 등록`);
}

/**
 * 단일 키워드에 대한 기본 크롤링 작업을 큐에 추가
 * 새로운 키워드가 생성될 때만 호출됨
 * @param {string} keyword - 크롤링할 키워드
 */
export async function addUserBasicJob(keyword) {
  if (!keyword) {
    logger.warn('[WARN] addUserBasicJob: 유효하지 않은 키워드');
    return;
  }
  
  await keywordQueue.add('unifiedProcess', { 
    type: 'userBasic', 
    data: { keywords: [keyword] }  // 배열 형태로 전달
  }, { 
    priority: 2,  // basic(4)보다 높은 우선순위
    jobId: `userBasic_${keyword.replace(/\s+/g, '_').substring(0, 30)}_${Date.now()}` // 중복 방지를 위한 고유 ID
  });
  
  logger.info(`[INFO] 새 키워드 "${keyword}"에 대한 크롤링 작업이 큐에 추가됨`);
}
/* -----------------------------------------------------------------------------------
 * (G) autoCrawlAll
 * ----------------------------------------------------------------------------------- */
export async function autoCrawlAll() {
  logger.info('[autoCrawlAll] Basic 크롤링 작업 등록 시작');
  await autoCheckAndAddBasicJobs();
  logger.info('[autoCrawlAll] 완료: 모든 필요한 작업이 큐에 등록되었습니다.');
}

// 서버 시작 시 초기화 및 스케줄러 설정
(async () => {
  try {    
    await Queue('keyword-crawl-queue').empty();
    await autoCheckAndAddBasicJobs();
    // 2. 매일 14:00에 autoCrawlAll 실행하는 스케줄러 설정
    const setupDailySchedule = () => {
      const now = new Date();
      const targetTime = new Date(now);
      targetTime.setHours(14, 0, 0, 0);
      
      if (now > targetTime) {
        targetTime.setDate(targetTime.getDate() + 1);
      }
      
      const timeUntilTarget = targetTime - now;
      
      logger.info(`[INFO] 크롤링 스케줄러가 시작되었습니다. 매일 14:00에 실행됩니다.`);
      logger.info(`[INFO] 다음 실행: ${targetTime.toISOString()} (${Math.round(timeUntilTarget/1000/60)} 분 후)`);
      
      setTimeout(() => {
        autoCrawlAll()
          .catch(err => logger.error('[ERROR] 자동 크롤링 실행 오류:', err));
        
        // 이후 매일 같은 시간에 실행
        setInterval(() => {
          autoCrawlAll()
            .catch(err => logger.error('[ERROR] 자동 크롤링 실행 오류:', err));
        }, 24 * 60 * 60 * 1000);
      }, timeUntilTarget);
    };
    setupDailySchedule();
  } catch (err) {
    logger.error('[ERROR] 서버 시작 시 초기화 중 오류:', err);
  }
})();
