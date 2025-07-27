import PlaceDetailResult from '../../models/PlaceDetailResult.js';
import '../../models/index.js';
import { fetchDetailHtml, parseDetailHtml } from './crawlerAxios.js';
import { createLogger } from '../../lib/logger.js';
import { Op } from 'sequelize';

const logger = createLogger('DetailCrawlerLogger', { service: 'crawler' });


/* -----------------------------------------------------------------------------------
 * 1) 통합 함수: 단일 장소 또는 키워드 연관 장소들 크롤링
 * ----------------------------------------------------------------------------------- */
export async function crawlAndUpdatePlace(placeDetailRecord, cycleStart) {
  const placeId = placeDetailRecord?.place_id || '알 수 없음';
  
  logger.info(`[INFO] placeId=${placeId} Detail 크롤링/업데이트 시작 (id=${placeDetailRecord.id})`);

  if (!placeDetailRecord || placeId === '알 수 없음') {
    throw new Error('유효하지 않은 placeDetailRecord 객체: place_id가 없거나 올바르지 않습니다.');
  }

  try {
    // 이미 크롤링된 레코드가 있고, 필요한 데이터가 모두 있으면 크롤링 건너뛰기
    if (placeDetailRecord.blog_review_count !== null && 
        placeDetailRecord.receipt_review_count !== null && 
        placeDetailRecord.keywordList !== null) {
      logger.info(`[INFO] placeId=${placeId} (id=${placeDetailRecord.id}) 이미 cycle 시작(${cycleStart.toISOString()}) 이후 데이터 완전하여 크롤링 완료됨, 스킵합니다.`);
      return { detailInfo: {
        blogReviewCount: placeDetailRecord.blog_review_count,
        visitorReviewCount: placeDetailRecord.receipt_review_count,
        keywordList: placeDetailRecord.keywordList ? JSON.parse(placeDetailRecord.keywordList) : []
      }, success: true, skipped: true };
    }

    // 크롤링 진행
    logger.info(`[INFO] placeId=${placeId} (id=${placeDetailRecord.id}) ${placeDetailRecord.last_crawled_at ? '데이터 불완전하여' : '오늘 데이터 없어'} 크롤링 진행`);
    
    // 429 에러 방지를 위한 지연 (2-4초 랜덤)
    const delay = Math.floor(Math.random() * 2000) + 2000; // 2000-4000ms
    logger.debug(`[DEBUG] placeId=${placeId} 크롤링 전 ${delay}ms 지연`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const isRestaurant = placeDetailRecord.is_restaurant === true;

    // 1) HTML 가져오기
    const detailHtml = await fetchDetailHtml(placeId, null, null, isRestaurant);

    // 2) 데이터 파싱
    const detailInfo = parseDetailHtml(detailHtml);

    // 저장수 처리: 현재 저장수 값이 null이고, todayRecord가 있는 경우 이전 사이클의 값 조회
    let currentSavedCount = placeDetailRecord.savedCount;
    
    if (currentSavedCount === null) {
      // 이전 사이클의 저장수 값이 있는지 확인
      const previousRecord = await PlaceDetailResult.findOne({
        where: {
          place_id: placeId,
          created_at: { [Op.lt]: cycleStart },
          savedCount: { [Op.ne]: null }
        },
        order: [['created_at', 'DESC']]
      });
      
      // 이전 저장수 값이 있으면 사용
      if (previousRecord && previousRecord.savedCount !== null) {
        currentSavedCount = previousRecord.savedCount;
        logger.debug(`[INFO] placeId=${placeId}: 이전 저장수 ${currentSavedCount} 재사용`);
      }
    }

    // 오늘의 레코드를 업데이트
    await placeDetailRecord.update({
      blog_review_count: detailInfo.blogReviewCount ?? 0,
      receipt_review_count: detailInfo.visitorReviewCount ?? 0,
      keywordList: Array.isArray(detailInfo.keywordList) 
        ? JSON.stringify(detailInfo.keywordList)
        : null,
      last_crawled_at: new Date(),
      savedCount: currentSavedCount, // 이전 저장수 값 또는 현재 값 사용
      crawl_status: 'success',
      last_error: null
    });
    logger.info(`[INFO] placeId=${placeId} 기존 레코드 업데이트 완료 (id=${placeDetailRecord.id})`);

    logger.info(`[INFO] placeId=${placeId} 상세크롤 완료`);
    return { detailInfo, success: true, skipped: false };
  } catch (err) {
    logger.error(`[ERROR] placeId=${placeId} (id=${placeDetailRecord.id}) 상세크롤 실패: ${err.message}`);
    // 실패 시에도 레코드 상태 업데이트는 crawlDetail에서 처리
    throw err;
  }
}

/* -----------------------------------------------------------------------------------
 * 2) 단일 place 크롤링의 저수준 로직
 * ----------------------------------------------------------------------------------- */
export async function crawlDetail({ placeId }) {
  // 입력값 검증
  if (!placeId) {
    throw new Error('placeId는 필수 파라미터입니다.');
  }

  // 14:00 기준 사이클 계산
  const now = new Date();
  const today14h = new Date(now);
  today14h.setHours(14, 0, 0, 0);
  const cycleStart = now >= today14h ? today14h : new Date(today14h.getTime() - 24 * 60 * 60 * 1000);

  let placeDetailRecord;
  let wasCreatedRecord = false;

  try {
    // 현재 사이클의 레코드를 찾거나 생성 (basicCrawl에서 이미 생성했을 수 있음)
    [placeDetailRecord, wasCreatedRecord] = await PlaceDetailResult.findOrCreate({
      where: {
        place_id: placeId,
        created_at: { [Op.gte]: cycleStart }
      },
      defaults: {
        place_id: placeId,
        blog_review_count: null,
        receipt_review_count: null,
        keywordList: null,
        savedCount: null,
        created_at: cycleStart, // 정확한 사이클 시작 시간으로 설정
        last_crawled_at: null
      }
    });

    if (wasCreatedRecord) {
      logger.info(`[INFO][crawlDetail] placeId=${placeId} 오늘 데이터 없어 새로 생성 (id=${placeDetailRecord.id}, cycleStart=${cycleStart.toISOString()}). basicCrawl에서 이름/맛집여부/저장수 설정 기대.`);
    } else {
      logger.info(`[INFO][crawlDetail] placeId=${placeId} 오늘 데이터 (id=${placeDetailRecord.id}) 찾음, 크롤링/업데이트 시도`);
    }
    
    // is_restaurant와 place_name은 basicCrawlerService에서 PlaceDetailResult에 저장한 값을 사용.
    // savedCount도 마찬가지. crawlAndUpdatePlace에서 null이면 이전 값을 찾아 사용.

    // 3) 크롤링 실행
    const result = await crawlAndUpdatePlace(placeDetailRecord, cycleStart);
    const wasSkipped = result.skipped === true;
    
    if (wasSkipped) {
      logger.info(`[INFO][crawlDetail] placeId=${placeId} (id=${placeDetailRecord.id}) Detail 크롤링 스킵됨 (last_crawled_at 유지)`);
    } else {
      // 성공 시 crawlAndUpdatePlace 내부에서 last_crawled_at 및 status 업데이트됨
      logger.info(`[INFO][crawlDetail] placeId=${placeId} (id=${placeDetailRecord.id}) Detail 크롤링 완료 (성공)`);
    }
    
    return { success: true, placeId, skipped: wasSkipped };
  } catch (err) {
    logger.error(`[ERROR][crawlDetail] placeId=${placeId} Detail 크롤링 실패: ${err.message}`);
    // 실패 시 현재 사이클의 레코드 상태 업데이트
    if (placeDetailRecord) {
      try {
        await placeDetailRecord.update({});
      } catch (updateError) {
        logger.error(`[ERROR][crawlDetail] placeId=${placeId} 실패 상태 업데이트 중 오류: ${updateError.message}`);
      }
    } else {
      // placeDetailRecord를 얻기 전(findOrCreate 실패 등)에 에러 발생 시 임시 레코드 생성 시도
      // 이 경우는 매우 드물지만, 로깅을 위해 시도할 수 있음
      try {
        await PlaceDetailResult.create({
          place_id: placeId,
          created_at: cycleStart, // 정확한 사이클 시작 시간으로 설정
          last_crawled_at: null
        });
         logger.info(`[INFO][crawlDetail] placeId=${placeId} 에러 발생하여 임시 실패 레코드 생성`);
      } catch (createError) {
        logger.error(`[ERROR][crawlDetail] placeId=${placeId} 임시 실패 레코드 생성 중 오류: ${createError.message}`);
      }
    }
    throw err;
  }
}