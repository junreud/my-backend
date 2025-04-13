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
import KeywordBasicCrawlResult from '../../models/KeywordBasicCrawlResult.js'; // Add missing import

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

// 키워드 큐 마지막 활동 시간과 타이머 추적을 위한 변수
let lastActivityTimestamp = Date.now();
let inactivityTimer = null;
const INACTIVITY_THRESHOLD = 6 * 60 * 1000; // 6분

// 큐 활동 감지를 위한 이벤트 핸들러 추가
keywordQueue.on('active', () => {
  logger.debug('[DEBUG] 큐 활동 감지: 타이머 리셋');
  lastActivityTimestamp = Date.now();
  resetInactivityTimer();
});

keywordQueue.on('completed', (job) => {
  logger.info(`[INFO][keyword-crawl-queue] 작업 완료: jobId=${job.id}`);
  lastActivityTimestamp = Date.now();
  resetInactivityTimer();
});

keywordQueue.on('failed', (job, err) => {
  logger.error(`[ERROR][keyword-crawl-queue] 작업 실패: jobId=${job.id}, err=${err.message}`);
  lastActivityTimestamp = Date.now();
  resetInactivityTimer();
});

keywordQueue.on('waiting', () => {
  lastActivityTimestamp = Date.now();
  resetInactivityTimer();
});

/**
 * 비활성 타이머를 리셋합니다.
 */
function resetInactivityTimer() {
  // 기존 타이머가 있으면 제거
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }
  
  // 새로운 타이머 설정
  inactivityTimer = setTimeout(async () => {
    const now = Date.now();
    const idleTime = now - lastActivityTimestamp;
    
    logger.info(`[INFO] 큐 비활성 타이머 실행: ${Math.round(idleTime / 1000)}초 동안 활동 없음`);
    
    if (idleTime >= INACTIVITY_THRESHOLD) {
      logger.info(`[INFO] 큐 비활성 감지: ${Math.round(idleTime / 1000 / 60)}분 동안 활동 없음. 불완전 데이터 처리 시작...`);
      await processIncompleteDetailRows();
    }
  }, INACTIVITY_THRESHOLD);
}

/**
 * 크롤링 시간을 기준으로 그룹화하여 크롤링 결과 비교
 * 2분 이내에 진행된 크롤링은 동일한 크롤링 세션으로 간주하고
 * 각 세션별 마지막 크롤링 결과로 비교
 * @param {number} threshold - 재크롤링 기준이 되는 결과 개수 차이 (기본값: 50)
 * @returns {Promise<Array>} - 재크롤링이 필요한 키워드 ID 배열
 */
async function findKeywordsWithSignificantChangeByCrawls(threshold = 50) {
  try {
    const now = new Date();
    const today14h = new Date(now);
    today14h.setHours(14, 0, 0, 0);
    const startDate = now < today14h ? 
      new Date(today14h.getTime() - 24 * 60 * 60 * 1000) : 
      today14h;
    const prevCycleStartDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);

    const keywords = await Keyword.findAll({
      attributes: ['id', 'keyword', 'basic_last_crawled_date'],
      where: { basic_last_crawled_date: { [Op.gte]: startDate } }
    });

    const keywordsToRecrawl = [];
    for (const keyword of keywords) {
      const todayResults = await KeywordBasicCrawlResult.findAll({
        attributes: ['keyword_id', 'created_at'],
        where: { 
          keyword_id: keyword.id, 
          created_at: { [Op.gte]: startDate } 
        },
        order: [['created_at', 'ASC']],
        raw: true
      });
      const todaySessions = groupCrawlSessionsByTime(todayResults, 2 * 60 * 1000);

      const yesterdayResults = await KeywordBasicCrawlResult.findAll({
        attributes: ['keyword_id', 'created_at'],
        where: { 
          keyword_id: keyword.id, 
          created_at: { [Op.gte]: prevCycleStartDate, [Op.lt]: startDate } 
        },
        order: [['created_at', 'ASC']],
        raw: true
      });
      const yesterdaySessions = groupCrawlSessionsByTime(yesterdayResults, 2 * 60 * 1000);

      if (todaySessions.length > 0 && yesterdaySessions.length > 0) {
        const lastTodaySession = todaySessions[todaySessions.length - 1];
        const lastYesterdaySession = yesterdaySessions[yesterdaySessions.length - 1];

        const todayResultCount = await KeywordBasicCrawlResult.count({
          where: { 
            keyword_id: keyword.id, 
            created_at: { 
              [Op.gte]: lastTodaySession.startTime,
              [Op.lt]: lastTodaySession.endTime
            } 
          }
        });

        const yesterdayResultCount = await KeywordBasicCrawlResult.count({
          where: { 
            keyword_id: keyword.id, 
            created_at: { 
              [Op.gte]: lastYesterdaySession.startTime, 
              [Op.lt]: lastYesterdaySession.endTime
            } 
          }
        });

        const countDifference = Math.abs(todayResultCount - yesterdayResultCount);
        const changeRate = yesterdayResultCount > 0 ? countDifference / yesterdayResultCount : 0;

        if ((countDifference >= threshold || changeRate >= 0.2) && yesterdayResultCount > 0) {
          logger.info(`[INFO] 키워드 ID ${keyword.id}: 어제=${yesterdayResultCount}, 오늘=${todayResultCount}, 차이=${countDifference}, 변화율=${changeRate.toFixed(2)}, 재크롤링 필요`);
          keywordsToRecrawl.push(keyword.id);
        }
      }
    }
    return keywordsToRecrawl;
  } catch (err) {
    logger.error(`[ERROR] 키워드 결과 변동 검사 중 오류: ${err.message}`);
    return [];
  }
}

/**
 * 시간 간격에 따라 크롤링 결과를 세션으로 그룹화
 * @param {Array} results - 크롤링 결과 배열
 * @param {number} timeThreshold - 같은 세션으로 간주할 최대 시간 간격 (밀리초)
 * @returns {Array} - 그룹화된 세션 배열
 */
function groupCrawlSessionsByTime(results, timeThreshold) {
  if (!results.length) return [];
  
  const sessions = [];
  let currentSession = {
    startTime: new Date(results[0].created_at),
    endTime: new Date(results[0].created_at),
    count: 1
  };
  
  for (let i = 1; i < results.length; i++) {
    const currentTime = new Date(results[i].created_at);
    const timeDiff = currentTime - currentSession.endTime;
    
    if (timeDiff <= timeThreshold) {
      currentSession.endTime = currentTime;
      currentSession.count++;
    } else {
      sessions.push(currentSession);
      currentSession = {
        startTime: currentTime,
        endTime: currentTime,
        count: 1
      };
    }
  }
  sessions.push(currentSession);
  return sessions;
}

/**
 * 우선순위에 따라 불완전 데이터를 처리하는 함수:
 * 1. basic_last_crawled_date가 14시 규칙에 따라 크롤링이 필요한 키워드 처리
 * 2. 어제/오늘 결과 개수 차이가 큰 키워드의 재크롤링
 * 3. 불완전한 detail 정보를 가진 장소 처리
 * 4. 어제는 있었지만 오늘 누락된 장소 처리
 */
async function processIncompleteDetailRows() {
  try {
    const now = new Date();
    const today14h = new Date(now);
    today14h.setHours(14, 0, 0, 0);
    const startDate = now < today14h ? 
      new Date(today14h.getTime() - 24 * 60 * 60 * 1000) : 
      today14h;

    let tasksAdded = false;

    // 1. basic_last_crawled_date 기준으로 크롤링이 필요한 키워드 검사
    const pendingCount = await autoCheckAndAddBasicJobs();
    logger.info(`[processIncompleteDetailRows] 기본 크롤링 필요 키워드: ${pendingCount}개`);
    if (pendingCount > 0) {
      tasksAdded = true;
      logger.info('[processIncompleteDetailRows] 기본 크롤링 작업 등록 완료');
    }

    // 2. 오늘/어제 결과 개수 차이가 큰 키워드 검색 및 재크롤링
    const keywordsToRecrawl = await findKeywordsWithSignificantChangeByCrawls(50);
    if (keywordsToRecrawl.length > 0) {
      tasksAdded = true;
      logger.info(`[processIncompleteDetailRows] 결과 차이가 큰 키워드 ${keywordsToRecrawl.length}개 재크롤링 시작`);
      for (const keywordId of keywordsToRecrawl) {
        await keywordQueue.add(
          'unifiedProcess',
          { type: 'basic', data: { keywordId, forceRecrawl: true } },
          { priority: 3, jobId: `recrawl_basic_${keywordId}_${Date.now()}`, removeOnComplete: true }
        );
        await randomDelay(0.5, 1);
      }
      logger.info(`[processIncompleteDetailRows] 결과 차이가 큰 키워드 재크롤링 작업 등록 완료`);
    }

    // 3. 불완전한 detail 데이터를 처리
    const incompleteRows = await PlaceDetailResult.findAll({
      where: {
        created_at: { [Op.gte]: startDate },
        [Op.or]: [
          { blog_review_count: null },
          { receipt_review_count: null },
          { keywordList: null }
        ]
      },
      order: [['id', 'ASC']],
      limit: 500
    });

    if (incompleteRows.length > 0) {
      tasksAdded = true;
      logger.info(`[processIncompleteDetailRows] 불완전한 detail 데이터 ${incompleteRows.length}개 처리 시작`);
      for (const row of incompleteRows) {
        await keywordQueue.add(
          'unifiedProcess',
          { type: 'detail', data: { placeId: row.place_id } },
          { priority: 5, jobId: `autofill_detail_${row.place_id}_${Date.now()}`, removeOnComplete: true }
        );
      }
      logger.info(`[processIncompleteDetailRows] 불완전한 detail 데이터 처리 작업 등록 완료`);
    }

    // 4. 어제는 있었지만 오늘 누락된 장소 처리
    const prevCycleStartDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
    const prevCyclePlaceIds = await PlaceDetailResult.findAll({
      attributes: ['place_id'],
      where: { created_at: { [Op.gte]: prevCycleStartDate, [Op.lt]: startDate } },
      group: ['place_id'],
      raw: true
    });
    const currentCyclePlaceIds = await PlaceDetailResult.findAll({
      attributes: ['place_id'],
      where: { created_at: { [Op.gte]: startDate } },
      group: ['place_id'],
      raw: true
    });
    const prevPlaceIdSet = new Set(prevCyclePlaceIds.map(row => row.place_id));
    const currentPlaceIdSet = new Set(currentCyclePlaceIds.map(row => row.place_id));
    const missingPlaceIds = [...prevPlaceIdSet].filter(id => !currentPlaceIdSet.has(id));

    if (missingPlaceIds.length > 0) {
      tasksAdded = true;
      const placeIdsToProcess = missingPlaceIds.slice(0, 500);
      logger.info(`[processIncompleteDetailRows] 누락된 장소 ${placeIdsToProcess.length}개 처리 시작 (전체 ${missingPlaceIds.length}개 중)`);
      for (const placeId of placeIdsToProcess) {
        await keywordQueue.add(
          'unifiedProcess',
          { type: 'detail', data: { placeId } },
          { priority: 4, jobId: `missing_detail_${placeId}_${Date.now()}`, removeOnComplete: true }
        );
      }
      logger.info(`[processIncompleteDetailRows] 누락된 장소 처리 작업 등록 완료`);
    }

    if (!tasksAdded) {
      logger.info('[processIncompleteDetailRows] 처리할 작업이 없습니다. 모든 데이터가 완전합니다.');
    }

    lastActivityTimestamp = Date.now();
    resetInactivityTimer();

    return tasksAdded; // 작업 추가 여부 반환
  } catch (err) {
    logger.error(`[ERROR] 불완전/누락 레코드 처리 중 오류: ${err.message}`);
    resetInactivityTimer();
    return false;
  }
}

/**
 * 수동으로 불완전 데이터를 처리하는 함수
 */
export async function manuallyTriggerIncompleteRows() {
  logger.info('[INFO] 수동 불완전 데이터 처리 시작...');
  await processIncompleteDetailRows();
  return { message: "불완전 데이터 처리 시작됨" };
}

// 서버 시작 시 타이머 초기화
resetInactivityTimer();

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
        const { keywordId, forceRecrawl } = data;
        logger.info(`[basic] keywordId=${keywordId} 시작${forceRecrawl ? ' (강제 재크롤링)' : ''}`);
        
        await crawlKeywordBasic(null, keywordId, 126.9783882, 37.5666103, forceRecrawl);
        logger.info(`[basic] keywordId=${keywordId} 완료${forceRecrawl ? ' (강제 재크롤링)' : ''}`);
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

    // 추가: 15분마다 불완전 데이터 처리 실행
    logger.info('[INFO] 불완전 데이터 처리 스케줄러가 시작되었습니다. 15분마다 실행됩니다.');
    setInterval(async () => {
      logger.info('[INFO] 정기 불완전 데이터 처리 실행 중...');
      await processIncompleteDetailRows()
        .catch(err => logger.error('[ERROR] 정기 불완전 데이터 처리 오류:', err));
    }, 15 * 60 * 1000); // 15분마다
  } catch (err) {
    logger.error('[ERROR] 서버 시작 시 초기화 중 오류:', err);
  }
})();
