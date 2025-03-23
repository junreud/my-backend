// keywordQueue.js
import Queue from 'bull';
import { crawlKeywordDetail } from './detailCrawlerService.js';
import { createLogger } from '../../lib/logger.js';
import PlaceDetailResult from '../../models/PlaceDetailResult.js'; // PlaceDetailResult 모델 추가
import { Op } from 'sequelize';

const logger = createLogger('KeywordQueueLogger');

// 큐 설정
const userSelectedQueue = new Queue('user-selected-queue', {
  redis: { host: '127.0.0.1', port: 6379 }
});

const autoCrawlQueue = new Queue('auto-crawl-queue', {
  redis: { host: '127.0.0.1', port: 6379 }
});

export const detailQueue = new Queue('detail-keyword-queue', {
  // redis connection options
  redis: {
    host: '127.0.0.1',
    port: 6379,
  }
});

export async function processDetailQueueJob(job) {
  const { keywordId } = job.data;

  try {
    logger.info(`[INFO] 디테일 크롤링 작업 시작: keywordId=${keywordId}`);
    await crawlKeywordDetail(keywordId);

    logger.info(`[INFO] 디테일 크롤링 작업 완료: keywordId=${keywordId}`);
    return { success: true, keywordId };
  } catch (err) {
    logger.error(`[ERROR] 디테일 크롤링 작업 실패: keywordId=${keywordId}`, err);
    throw err;
  }
}

detailQueue.process(processDetailQueueJob);

// 사용자 선택 작업 처리 - 우선순위 높음 (priority: 1)
userSelectedQueue.process(async (job, done) => {
  const { keywordId } = job.data;
  logger.info(`[INFO][UserSelectedQueue] 사용자 선택 작업 시작: keywordId=${keywordId}`);

  try {
    // 자동 크롤링 작업 일시 중지 (사용자 선택 작업 우선 처리)
    await autoCrawlQueue.pause();
    logger.info('[INFO] 자동 크롤링 큐 일시 중지 (사용자 선택 작업 우선 처리)');

    // isKeywordId 매개변수를 true로 전달 (기본값이지만 명시적으로 표시)
    await crawlKeywordDetail(keywordId, 100, null, true);

    logger.info(`[INFO][UserSelectedQueue] 사용자 선택 작업 완료: keywordId=${keywordId}`);

    // 자동 크롤링 작업 재개
    await autoCrawlQueue.resume();
    logger.info('[INFO] 자동 크롤링 큐 재개');

    done();
  } catch (err) {
    logger.error(`[ERROR][UserSelectedQueue] 사용자 선택 작업 실패: keywordId=${keywordId}`, err);

    // 오류가 발생해도 자동 크롤링 작업 재개
    try {
      await autoCrawlQueue.resume();
      logger.info('[INFO] 오류 후 자동 크롤링 큐 재개');
    } catch (resumeErr) {
      logger.error('[ERROR] 자동 크롤링 큐 재개 중 오류:', resumeErr);
    }

    done(err);
  }
});

// 자동 크롤링 작업 처리 - 우선순위 낮음 (priority: 2)
autoCrawlQueue.process(async (job, done) => {
  logger.info('[INFO][AutoCrawlQueue] 자동 크롤링 작업 시작');
  try {
    // PlaceDetailResult 테이블에서 last_crawled_at이 null이거나 오래된 항목 찾기
    const now = new Date();
    const oneDayAgo = new Date(now);
    oneDayAgo.setDate(now.getDate() - 1); // 24시간 전

    const pendingPlaces = await PlaceDetailResult.findAll({
      where: {
        [Op.or]: [
          { last_crawled_at: null }, // 한 번도 크롤링되지 않은 항목
          { last_crawled_at: { [Op.lt]: oneDayAgo } } // 24시간 이상 지난 항목
        ]
      },
      limit: 100 // 배치 크기 조정 가능
    });

    logger.info(`[INFO][AutoCrawlQueue] ${pendingPlaces.length}개 장소 상세 크롤링 시작`);

    // 각 장소에 대해 상세 크롤링 작업 실행
    for (const place of pendingPlaces) {
      logger.info(`[INFO][AutoCrawlQueue] 장소 상세 크롤링 시작: placeId=${place.place_id}`);
      await crawlKeywordDetail(place.place_id); // place_id를 넘겨서 크롤링

      // 크롤링 후 last_crawled_at 업데이트
      await place.update({ last_crawled_at: new Date() });
      logger.info(`[INFO][AutoCrawlQueue] 장소 상세 크롤링 완료: placeId=${place.place_id}`);
    }

    logger.info('[INFO][AutoCrawlQueue] 자동 크롤링 작업 완료');
    done();
  } catch (err) {
    logger.error('[ERROR][AutoCrawlQueue] 자동 크롤링 작업 실패', err);
    done(err);
  }
});

// 주기적으로 place_detail_results 테이블 모니터링
function startPlaceDetailMonitoring() {
  // 5분마다 실행
  setInterval(async () => {
    try {
      // 처리가 필요한 항목이 있는지 확인
      const count = await PlaceDetailResult.count({
        where: {
          [Op.or]: [
            { last_crawled_at: null },
            { last_crawled_at: { [Op.lt]: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
          ]
        }
      });

      if (count > 0) {
        logger.info(`[INFO] 처리가 필요한 상세 크롤링 항목 ${count}개 발견, 작업 큐에 추가`);
        await autoCrawlQueue.add({}, { priority: 2 });
      }
    } catch (err) {
      logger.error('[ERROR] place_detail_results 모니터링 중 오류:', err);
    }
  }, 5 * 60 * 1000); // 5분 = 300,000ms

  logger.info('[INFO] place_detail_results 모니터링 시작됨 (5분 간격)');
}

// 서버 시작 시 모니터링 시작
startPlaceDetailMonitoring();

// 에러/완료 이벤트 등 추가 가능
detailQueue.on('completed', (job) => {
  logger.info(`[BULL] Job 완료: id=${job.id}, keywordId=${job.data.keywordId}`);
});
detailQueue.on('failed', (job, err) => {
  logger.error(`[BULL][ERROR] Job 실패: id=${job.id}, keywordId=${job.data.keywordId}, error=${err}`);
});

// 큐 이벤트 리스너 (선택 사항)
userSelectedQueue.on('completed', (job) => {
  logger.info(`[BULL][UserSelectedQueue] Job 완료: id=${job.id}, keywordId=${job.data.keywordId}`);
});

userSelectedQueue.on('failed', (job, err) => {
  logger.error(`[BULL][UserSelectedQueue][ERROR] Job 실패: id=${job.id}, keywordId=${job.data.keywordId}, error=${err}`);
});

autoCrawlQueue.on('completed', (job) => {
  logger.info(`[BULL][AutoCrawlQueue] Job 완료: id=${job.id}`);
});

autoCrawlQueue.on('failed', (job, err) => {
  logger.error(`[BULL][AutoCrawlQueue][ERROR] Job 실패: id=${job.id}, error=${err}`);
});

async function addUserSelectedKeywordJob(keywordId) {
  try {
    // 사용자 선택 작업 큐에 추가 (우선순위: 1)
    await userSelectedQueue.add({ keywordId }, { priority: 1 });
    logger.info(`[INFO] 사용자 선택 키워드 ID ${keywordId} 작업 큐에 추가됨 (우선순위: 높음)`);
    return true;
  } catch (error) {
    logger.error(`[ERROR] 사용자 선택 키워드 작업 추가 실패: ${error.message}`);
    return false;
  }
}

// 큐 내보내기 (addUserSelectedKeywordJob을 포함)
export { userSelectedQueue, autoCrawlQueue, addUserSelectedKeywordJob };