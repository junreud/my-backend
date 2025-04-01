// 이 스크립트는 place_detail_results 테이블에서 null 필드를 가진 레코드를 찾아
// detail 크롤링 작업을 큐에 추가합니다

import { createLogger } from '../lib/logger.js';
import PlaceDetailResult from '../models/PlaceDetailResult.js';
import '../models/index.js'; // Sequelize 관계 로드
import { keywordQueue } from '../services/crawler/keywordQueue.js';
import { Op } from 'sequelize';
const logger = createLogger('NullFieldsScript');

/**
 * 예시: items 배열을 1000단위로 나누어 처리
 */
async function addJobsInChunks(items) {
  const chunkSize = 1000;
  let startIndex = 0;
  
  while (startIndex < items.length) {
    const chunk = items.slice(startIndex, startIndex + chunkSize);
    startIndex += chunkSize;

    logger.info(`새 작업 청크 등록: ${chunk.length}개`);

    // 수정: 통합 프로세서 사용
    for (const placeId of chunk) {
      await keywordQueue.add('unifiedProcess', { 
        type: 'detail', 
        data: { placeId } 
      }, { priority: 5 });
    }    
    logger.info(`청크 처리 완료`);
  }

  logger.info(`총 ${items.length}개 작업 등록 완료`);
}

async function autoCheckAndAddNullFieldsDetailJobs() {
  logger.info('[INFO] autoCheckAndAddNullFieldsDetailJobs start...');

  const now = new Date();
  const today14h = new Date(now);
  today14h.setHours(14, 0, 0, 0);
  
  // 날짜 범위 결정
  const startDate = now < today14h ? 
    new Date(today14h.getTime() - 24 * 60 * 60 * 1000) : // 어제 14:00
    today14h; // 오늘 14:00

  // 현재 날짜 범위 내의 null 필드만 찾기
  const places = await PlaceDetailResult.findAll({
    where: {
      [Op.or]: [
        { blog_review_count: null },
        { receipt_review_count: null },
        { keywordList: null },
        { last_crawled_at: null },
      ],
      created_at: {
        [Op.gte]: startDate  // 날짜 제한 추가
      }
    },
    attributes: ['place_id'],
    raw: true
  });

  logger.info(`[INFO] 총 ${places.length}개의 null 필드 place 발견, 1000개씩 처리 시작`);
  
  // 모든 place_id 배열 추출
  const placeIds = places.map(place => place.place_id);
  
  // 1000개씩 chunk 처리 (수정된 함수 사용)
  await addJobsInChunks(placeIds);
  
  logger.info(`[INFO] autoCheckAndAddNullFieldsDetailJobs: 총 ${places.length}개 place 등록 완료`);
}

async function main() {
  try {
    logger.info('======= NULL 필드 찾기 및 크롤링 작업 등록 시작 =======');
    await autoCheckAndAddNullFieldsDetailJobs();
    logger.info('======= 작업 등록 완료 =======');
    
    // 모든 큐 작업이 등록된 후 일정 시간 대기 (로그 출력을 위해)
    await new Promise(resolve => setTimeout(resolve, 3000));
    process.exit(0);
  } catch (error) {
    logger.error('작업 등록 중 오류 발생:', error);
    process.exit(1);
  }
}

// 스크립트 실행
main();