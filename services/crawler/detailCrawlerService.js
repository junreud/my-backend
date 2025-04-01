
import PlaceDetailResult from '../../models/PlaceDetailResult.js';
import '../../models/index.js';
import { fetchDetailHtml, parseDetailHtml } from './crawlerAxios.js';
import { createLogger } from '../../lib/logger.js';
import { Op } from 'sequelize';

const logger = createLogger('DetailCrawlerLogger', { service: 'crawler' });


/* -----------------------------------------------------------------------------------
 * 1) 통합 함수: 단일 장소 또는 키워드 연관 장소들 크롤링
 * ----------------------------------------------------------------------------------- */
export async function crawlAndUpdatePlace(row) {
  const placeId = row?.place_id || '알 수 없음';
  
  logger.info(`[INFO] placeId=${placeId} Detail 크롤링 시작`);

  if (!row || !placeId || placeId === '알 수 없음') {
    throw new Error('유효하지 않은 row 객체: place_id가 없거나 올바르지 않습니다.');
  }

  try {
    // row.is_restaurant가 없으면 false로 가정
    const isRestaurant = row?.is_restaurant === true;

    // 1) HTML 가져오기
    const detailHtml = await fetchDetailHtml(placeId, null, null, isRestaurant);

    // 2) 데이터 파싱
    const detailInfo = parseDetailHtml(detailHtml);

    // 3) 오늘의 레코드 찾거나 새로 생성 (14:00 규칙 적용)
    const now = new Date();
    const today14h = new Date(now);
    today14h.setHours(14, 0, 0, 0);
    
    // 날짜 범위 결정 (오늘 14:00 전/후에 따라)
    const startDate = now < today14h ? 
      new Date(today14h.getTime() - 24 * 60 * 60 * 1000) : // 어제 14:00
      today14h; // 오늘 14:00
    
    // 오늘(또는 현재 날짜 범위) 내의 레코드 찾기
    const todayRecord = await PlaceDetailResult.findOne({
      where: {
        place_id: row.place_id,
        created_at: {
          [Op.gte]: startDate
        }
      },
      order: [['id', 'DESC']]
    });

    if (todayRecord) {
      // 오늘의 레코드가 있으면 업데이트
      await todayRecord.update({
        blog_review_count: detailInfo.blogReviewCount ?? 0,
        receipt_review_count: detailInfo.visitorReviewCount ?? 0,
        keywordList: Array.isArray(detailInfo.keywordList) 
          ? JSON.stringify(detailInfo.keywordList)
          : null,
        last_crawled_at: new Date()
      });
      logger.info(`[INFO] placeId=${placeId} 기존 레코드 업데이트 완료 (id=${todayRecord.id})`);
    } else {
      // 오늘의 레코드가 없으면 생성
      await PlaceDetailResult.create({
        place_id: row.place_id,
        place_name: row.place_name || '알 수 없음',
        blog_review_count: detailInfo.blogReviewCount ?? 0,
        receipt_review_count: detailInfo.visitorReviewCount ?? 0,
        keywordList: Array.isArray(detailInfo.keywordList) 
          ? JSON.stringify(detailInfo.keywordList)
          : null,
        last_crawled_at: new Date(),
        savedCount: row.savedCount // 기존 savedCount 값 유지
      });
      logger.info(`[INFO] placeId=${placeId} 새 레코드 생성 완료`);
    }

    logger.info(`[INFO] placeId=${placeId} 상세크롤 완료`);
    return { detailInfo, success: true };
  } catch (err) {
    logger.error(`[ERROR] placeId=${placeId} 상세크롤 실패: ${err.message}`);
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

  // 1) 'processing' 상태로 업데이트
  await PlaceDetailResult.update(
    { crawl_status: 'processing' },
    { where: { place_id: placeId } }
  );

  // 2) DB에서 row 정보 가져오기
  const placeInfo = await PlaceDetailResult.findOne({ where: { place_id: placeId } });
  const row = {
    place_id: placeId,
    place_name: placeInfo?.place_name || '알 수 없음',
    is_restaurant: placeInfo?.is_restaurant || false
  };

  try {
    // 3) 크롤링 실행
    await crawlAndUpdatePlace(row);

    // 4) 성공 시 상태 업데이트
    await PlaceDetailResult.update(
      { 
        crawl_status: 'success',
        last_error: null,
        last_crawled_at: new Date() 
      },
      { where: { place_id: placeId } }
    );
    
    logger.info(`[INFO][crawlDetail] placeId=${placeId} Detail 크롤링 완료 (성공)`);
    return { success: true, placeId };
  } catch (err) {
    // 5) 실패 시 상태 업데이트
    await PlaceDetailResult.update(
      { 
        crawl_status: 'failed',
        last_error: err.message
      },
      { where: { place_id: placeId } }
    );
    
    logger.error(`[ERROR][crawlDetail] placeId=${placeId} Detail 크롤링 실패: ${err.message}`);
    throw err;
  }
}