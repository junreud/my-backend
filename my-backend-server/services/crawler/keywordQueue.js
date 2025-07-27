// keywordQueue.js
import Queue from 'bull';
import { Op } from 'sequelize';
import Keyword from '../../models/Keyword.js';
import PlaceDetailResult from '../../models/PlaceDetailResult.js';
import '../../models/index.js'; // Sequelize 관계 로드
import { crawlDetail as detailCrawlerService} from './detailCrawlerService.js'; // Correct import path
import { crawlKeywordBasic } from './basicCrawlerService.js'; // Added import for basic crawl
import KeywordBasicCrawlResult from '../../models/KeywordBasicCrawlResult.js'; // Add missing import
import { createLogger } from '../../lib/logger.js';
import cron from 'node-cron'; // cron 스케줄러 추가

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
      delay: 15000 // 실패 시 30초부터 지수적으로 증가
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
      // 활성 작업이 있는지 확인, 있으면 스킵 후 타이머 재설정
      const counts = await keywordQueue.getJobCounts();
      if (counts.active > 0) {
        logger.info(`[INFO] 현재 활성 작업이 ${counts.active}개 있어 비활성 데이터 보완을 건너뜁니다.`);
        resetInactivityTimer();
        return;
      }
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

        const todayResultCount = lastTodaySession.count;
        const yesterdayResultCount = lastYesterdaySession.count;

        // 중간값(100단위가 아닌 값)은 정상 크롤링으로 간주, 재크롤링 제외
        if (todayResultCount % 100 !== 0) {
          logger.info(`[INFO] 키워드 ID ${keyword.id}: 오늘 결과 중간값(${todayResultCount}), 재크롤링 제외`);
          continue;
        }
        const countDifference = Math.abs(todayResultCount - yesterdayResultCount);
        const changeRate = yesterdayResultCount > 0 ? countDifference / yesterdayResultCount : 0;

        // 오늘 개수가 어제보다 적을 때만 재크롤링
        if (
          todayResultCount < yesterdayResultCount &&
          (countDifference >= threshold || changeRate >= 0.2) && yesterdayResultCount > 0
        ) {
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
  logger.debug('[DEBUG][processIncompleteDetailRows] 불완전 데이터 처리 시작...');
  let jobsAddedCount = 0;

  try {
    // 1. basic_last_crawled_date가 14시 규칙에 따라 크롤링이 필요한 키워드 처리 (autoCheckAndAddBasicJobs가 담당)
    // 여기서는 주로 Detail 정보가 불완전한 경우를 처리합니다.

    // 2. 어제/오늘 결과 개수 차이가 큰 키워드의 재크롤링 (이 로직은 basic-crawl을 유발해야 함)
    const keywordsForReBasicCrawl = await findKeywordsWithSignificantChangeByCrawls();
    for (const keywordId of keywordsForReBasicCrawl) {
      const kw = await Keyword.findByPk(keywordId);
      if (kw) {
        logger.info(`[INFO][processIncompleteDetailRows] 결과 개수 변화로 키워드 '${kw.keyword}' (ID: ${kw.id}) 'basic-crawl' 작업 추가`);
        const coords = kw.preferences?.coordinates || { x: 126.9783882, y: 37.5666103 };
        await keywordQueue.add('basic-crawl', {
          keyword: kw.keyword,
          keywordId: kw.id,
          baseX: coords.x,
          baseY: coords.y,
          forceRecrawl: true // 변화 감지 시 재크롤링
        });
        jobsAddedCount++;
      }
    }

    // 3. 불완전한 detail 정보를 가진 장소 처리 (PlaceDetailResult에서 last_crawled_at이 없거나 특정 필드가 null)
    // 예: 오늘자 레코드 중 detail 정보가 없는 경우
    const now = new Date();
    const today14h = new Date(now);
    today14h.setHours(14, 0, 0, 0);
    const cycleStart = now >= today14h ? today14h : new Date(today14h.getTime() - 24 * 60 * 60 * 1000);

    const incompletePlaces = await PlaceDetailResult.findAll({
      where: {
        created_at: { [Op.gte]: cycleStart }, // 오늘자 레코드
        [Op.or]: [ // 상세 정보가 하나라도 없는 경우
          { blog_review_count: null },
          { receipt_review_count: null },
        ],
      },
      attributes: ['place_id', 'id']
    });

    for (const place of incompletePlaces) {
      logger.info(`[INFO][processIncompleteDetailRows] 불완전 상세 정보 장소 ${place.place_id} (PDR_id=${place.id}) 'detail-crawl' 작업 추가`);
      await keywordQueue.add('detail-crawl', { placeId: place.place_id });
      jobsAddedCount++;
    }

    // 4. 어제는 있었지만 오늘 누락된 장소 처리 (이 로직은 basic-crawl을 유발할 수 있음)
    // 이 부분은 로직이 복잡하며, KeywordBasicCrawlResult 비교 등을 통해 누락된 placeId를 찾아
    // 해당 placeId를 포함하는 키워드에 대해 basic-crawl을 다시 트리거하거나,
    // 직접 detail-crawl을 시도할 수 있습니다. (요구사항에 따라 결정)

    if (jobsAddedCount > 0) {
      logger.info(`[INFO][processIncompleteDetailRows] 총 ${jobsAddedCount}개의 불완전 데이터 처리 작업 추가 완료.`);
    } else {
      logger.debug('[DEBUG][processIncompleteDetailRows] 추가할 불완전 데이터 처리 작업 없음.');
    }

  } catch (error) {
    logger.error(`[ERROR][processIncompleteDetailRows] 불완전 데이터 처리 중 오류: ${error.message}`, error);
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

// 큐 비우기 (프로덕션에서도 시작 시 기존 작업 제거)
await keywordQueue.empty().catch(err => logger.warn('[WARN] 큐 비우기 실패:', err));

/* -----------------------------------------------------------------------------------
 * 실제 크롤링 로직: basic / detail 전부에서 사용
 * (batchSize 관련 로직 제거)
 * ----------------------------------------------------------------------------------- */

// (2) detail 크롤링 (placeId만 처리)
async function processDetailCrawl({ placeId }) {
  if (!placeId) {
    logger.error('[ERROR][processDetailCrawl] placeId가 제공되지 않았습니다.');
    throw new Error('placeId is required for detail crawl job');
  }
  try {
    logger.info(`[INFO][processDetailCrawl] placeId=${placeId} 상세 크롤링 시작`);
    // detailCrawlerService.js의 crawlDetail 함수를 직접 호출
    const result = await detailCrawlerService({ placeId }); // crawlDetail은 객체 { placeId } 를 인자로 받음
    logger.info(`[INFO][processDetailCrawl] placeId=${placeId} 상세 크롤링 완료. Success: ${result.success}, Skipped: ${result.skipped}`);
    return result;
  } catch (error) {
    logger.error(`[ERROR][processDetailCrawl] placeId=${placeId} 상세 크롤링 중 오류: ${error.message}`);
    // 여기서 에러를 다시 throw하여 BullMQ가 재시도 등을 처리하도록 함
    throw error;
  }
} 

/* -----------------------------------------------------------------------------------
 * 큐 처리 로직 - 각각 다른 concurrency로 등록
 * ----------------------------------------------------------------------------------- */

// Basic Crawl Processor: Concurrency 1
keywordQueue.process('basic-crawl', 1, async (job) => {
  const { keyword, keywordId, baseX, baseY, forceRecrawl } = job.data;
  logger.info(`[INFO][basic-crawl] 작업 시작: jobId=${job.id}, keywordId=${keywordId}, keyword=${keyword}`);
  try {
    // crawlKeywordBasic은 내부적으로 성공 시 detail-crawl 작업을 큐에 추가해야 함
    await crawlKeywordBasic(keyword, keywordId, baseX, baseY, forceRecrawl);
    logger.info(`[INFO][basic-crawl] 작업 성공: jobId=${job.id}, keywordId=${keywordId}`);
  } catch (error) {
    logger.error(`[ERROR][basic-crawl] 작업 실패: jobId=${job.id}, keywordId=${keywordId}, error: ${error.message}`);
    throw error; // BullMQ가 재시도 등을 처리하도록 에러를 다시 던짐
  }
});

// Detail Crawl Processor: Concurrency 6 (optimized for speed with delay)
keywordQueue.process('detail-crawl', 6, async (job) => {
  const { placeId } = job.data;
  logger.info(`[INFO][detail-crawl] 작업 시작: jobId=${job.id}, placeId=${placeId}`);
  try {
    await processDetailCrawl({ placeId }); // Uses the existing wrapper
    
    // 작업 완료 후 1초 지연
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1000ms
    
    logger.info(`[INFO][detail-crawl] 작업 성공: jobId=${job.id}, placeId=${placeId}`);
  } catch (error) {
    logger.error(`[ERROR][detail-crawl] 작업 실패: jobId=${job.id}, placeId=${placeId}, error: ${error.message}`);
    throw error; // BullMQ가 재시도 등을 처리하도록 에러를 다시 던짐
  }
});

// Remove or comment out the old unifiedProcess
// keywordQueue.process('unifiedProcess', 10, async (job) => {…});

/* -----------------------------------------------------------------------------------
 * (E) 14:00 조건 자동 크롤링 (기존)
 * ----------------------------------------------------------------------------------- */
export async function autoCheckAndAddBasicJobs() {
  logger.info('[INFO] 자동 기본 크롤링 작업 추가 시작 (14시 스케줄러)...');
  const keywords = await Keyword.findAll({
    attributes: ['id', 'keyword', 'basic_last_crawled_date']
    // is_active와 preferences 컬럼이 없으므로 기본 attributes만 사용
  });

  let addedCount = 0;
  for (const kw of keywords) {
    if (shouldBasicCrawlKeyword(kw.basic_last_crawled_date)) {
      // preferences가 없으므로 기본 좌표 사용
      const coords = { x: 126.9783882, y: 37.5666103 }; // 서울 시청 기준
      logger.info(`[INFO][autoCheckAndAddBasicJobs] 키워드 '${kw.keyword}' (ID: ${kw.id}) 'basic-crawl' 작업 추가`);
      await keywordQueue.add('basic-crawl', {
        keyword: kw.keyword,
        keywordId: kw.id,
        baseX: coords.x,
        baseY: coords.y,
        forceRecrawl: false
      });
      addedCount++;
    }
  }
  logger.info(`[INFO][autoCheckAndAddBasicJobs] 총 ${addedCount}개의 'basic-crawl' 작업 추가 완료.`);
}

/**
 * 단일 키워드에 대한 기본 크롤링 작업을 큐에 추가
 * 새로운 키워드가 생성될 때만 호출됨
 * @param {string} keyword - 크롤링할 키워드
 */
export async function addUserBasicJob(keyword) {
  if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') {
    logger.warn('[WARN][addUserBasicJob] 유효하지 않은 키워드 제공됨');
    return { success: false, message: '유효하지 않은 키워드입니다.' };
  }

  try {
    const [newKeyword, created] = await Keyword.findOrCreate({
      where: { keyword: keyword.trim() },
      defaults: {
        keyword: keyword.trim(),
        is_active: true,
        // basic_last_crawled_date는 처음에는 null이므로 shouldBasicCrawlKeyword에 의해 크롤링됨
      }
    });

    logger.info(`[INFO][addUserBasicJob] 키워드 '${newKeyword.keyword}' (ID: ${newKeyword.id}, 생성됨: ${created}) 'basic-crawl' 작업 추가 (forceRecrawl: true)`);
    await keywordQueue.add('basic-crawl', {
      keyword: newKeyword.keyword,
      keywordId: newKeyword.id,
      // baseX, baseY는 기본값 사용 또는 Keyword.preferences에서 가져오도록 crawlKeywordBasic에서 처리
      forceRecrawl: true // 사용자가 직접 추가한 경우 강제 재크롤링 또는 즉시 크롤링
    });
    return { success: true, keywordId: newKeyword.id, message: `키워드 '${newKeyword.keyword}' 기본 크롤링 작업이 추가되었습니다.` };
  } catch (error) {
    logger.error(`[ERROR][addUserBasicJob] 키워드 '${keyword}' 작업 추가 중 오류: ${error.message}`);
    return { success: false, message: '작업 추가 중 오류가 발생했습니다.' };
  }
}


// 큐 비우기 (테스트용)
// await keywordQueue.empty(); // 개발/테스트 시에만 사용하고 프로덕션에서는 주석 처리 또는 제거

// 추가: 1분마다 불완전 데이터 처리 실행
setInterval(async () => {
  const counts = await keywordQueue.getJobCounts();
  if (counts.active > 0) {
    logger.info(`[INFO] 현재 활성 중인 작업이 ${counts.active}개 있어 불완전 데이터 등록을 건너뜁니다.`);
    return;
  }
  logger.info('[INFO] 정기 불완전 데이터 처리 실행 중...');
  await processIncompleteDetailRows().catch(err => logger.error('[ERROR] 정기 불완전 데이터 처리 오류:', err));
}, 1 * 60 * 1000);

/**
 * 크롤링 스케줄러 설정
 * 매일 14:00에 자동으로 모든 활성 키워드에 대한 기본 크롤링 실행
 * 5분마다 크롤링이 안된 키워드 체크
 */
function setupCrawlingScheduler() {
  logger.info('[SCHEDULER] 크롤링 스케줄러 설정 중...');
  
  // 매일 14:00에 자동 크롤링 실행
  cron.schedule('0 14 * * *', async () => {
    try {
      logger.info('[SCHEDULER] 14:00 자동 크롤링 시작...');
      await autoCheckAndAddBasicJobs();
      logger.info('[SCHEDULER] 14:00 자동 크롤링 작업 추가 완료');
    } catch (error) {
      logger.error('[SCHEDULER] 14:00 자동 크롤링 실행 중 오류:', error.message);
    }
  }, {
    timezone: "Asia/Seoul" // 한국 시간 기준
  });
  
  // 개발환경에서는 추가로 매 시간마다 테스트 실행
  if (process.env.NODE_ENV === 'development') {
    cron.schedule('0 * * * *', async () => {
      try {
        logger.info('[SCHEDULER] [DEV] 시간당 자동 크롤링 테스트 시작...');
        await autoCheckAndAddBasicJobs();
        logger.info('[SCHEDULER] [DEV] 시간당 자동 크롤링 테스트 완료');
      } catch (error) {
        logger.error('[SCHEDULER] [DEV] 시간당 자동 크롤링 테스트 중 오류:', error.message);
      }
    }, {
      timezone: "Asia/Seoul"
    });
  }
  
  // 5분마다 크롤링 안 된 키워드 체크 (개발/운영 공통)
  cron.schedule('*/5 * * * *', async () => {
    try {
      logger.info('[SCHEDULER] [5분마다] 크롤링 안 된 키워드 체크 시작...');
      await autoCheckAndAddBasicJobs();
      logger.info('[SCHEDULER] [5분마다] 크롤링 안 된 키워드 체크 완료');
    } catch (error) {
      logger.error('[SCHEDULER] [5분마다] 크롤링 안 된 키워드 체크 중 오류:', error.message);
    }
  }, {
    timezone: "Asia/Seoul"
  });
  
  logger.info('[SCHEDULER] 크롤링 스케줄러 설정 완료');
  logger.info('[SCHEDULER] - 매일 14:00 (KST)에 자동 크롤링 실행');
  logger.info('[SCHEDULER] - 5분마다 크롤링 안 된 키워드 체크');
  if (process.env.NODE_ENV === 'development') {
    logger.info('[SCHEDULER] - [DEV] 매 시간 정각에 테스트 크롤링 실행');
  }
}

// 스케줄러 자동 시작
setupCrawlingScheduler();
