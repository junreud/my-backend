// detailCrawler.js
import { Op, Sequelize } from 'sequelize';
import sequelize from '../../config/db.js';
import KeywordBasicCrawlResult from '../../models/KeywordBasicCrawlResult.js';
import PlaceDetailResult from '../../models/PlaceDetailResult.js'; // Correct model name
import Keyword from '../../models/Keyword.js';
// Import relationships to ensure they're loaded
import '../../models/index.js';
import { fetchDetailHtml, parseDetailHtml } from './crawlerAxios.js';
import { 
  randomDelay, 
  loadMobileUAandCookies 
} from '../../config/crawler.js';
import { createLogger } from '../../lib/logger.js';
import { updateKeywordBasicCrawled, getValidAttributes } from './dbHelpers.js';
const logger = createLogger('DetailCrawlerLogger');

/**
 * 디테일(상세) 크롤링:
 *   1) keyword 테이블에서 detail_crawled=false인 키워드 찾기
 *   2) 해당 키워드에 대한 모든 place 정보 가져오기
 *   3) placeId마다 fetchDetailHtml -> parseDetailHtml (7개씩 병렬 처리)
 *   4) DB update (blog_review_count, receipt_review_count, keywordList)
 *   5) 실패한 항목에 대해 2회까지 재시도
 *   6) 모든 처리가 완료되면 keyword 테이블의 detail_crawled=true로 업데이트
 */

/**
 * 개별 장소 상세 정보 크롤링 및 업데이트
 */
async function crawlAndUpdatePlace(row, cookieStr, ua, progressInfo = {}, crawlJobId) {
  // 기본값 설정으로 undefined 오류 방지
  const { keywordName = "알 수 없음", current = 0, total = 0 } = progressInfo;
  const placeId = row?.place_id || "알 수 없음";
  
  // 향상된 로그 메시지
  logger.info(`[INFO] 키워드 "${keywordName}" (${current}/${total}) - placeId=${placeId} 크롤링 시작`);
  
  // 유효성 검사 추가
  if (!row || !placeId || placeId === "알 수 없음") {
    throw new Error("유효하지 않은 row 객체: place_id가 없거나 올바르지 않습니다.");
  }
  
  try {
    // row.is_restaurant이 undefined인 경우 기본값으로 false 사용
    const isRestaurant = row?.is_restaurant === true;
    
    const detailHtml = await fetchDetailHtml(
      placeId, 
      cookieStr, 
      ua, 
      isRestaurant
    );
    const detailInfo = parseDetailHtml(detailHtml);

    // PlaceDetailResult 모델을 사용하여 저장 - 수정된 필드명 사용
    await PlaceDetailResult.upsert({
      place_id: row.place_id, // 필수 필드
      // keywordId 또는 keyword_id 둘 중 하나만 사용
      // 모델 정의에 맞는 필드 사용
      // 여기서는 모델에 있는 필드만 포함
      blog_review_count: detailInfo.blogReviewCount ?? 0,
      receipt_review_count: detailInfo.visitorReviewCount ?? 0,
      keywordList: Array.isArray(detailInfo.keywordList) 
        ? JSON.stringify(detailInfo.keywordList)
        : null,
      crawl_job_id: crawlJobId, 
      last_crawled_at: new Date() 
    });
    
    // row.save가 함수인지 확인 후 호출
    if (typeof row.save === 'function') {
      await row.save();
    } else {
      logger.error(`[ERROR] row.save is not a function for placeId=${placeId}`);
      // 대체 방법으로 업데이트 수행
      await PlaceDetailResult.update(
        {
          blog_review_count: detailInfo.blogReviewCount ?? 0,
          receipt_review_count: detailInfo.visitorReviewCount ?? 0,
          keywordList: Array.isArray(detailInfo.keywordList) 
            ? JSON.stringify(detailInfo.keywordList)
            : null,
          last_crawled_at: new Date()
        },
        { where: { place_id: placeId } } // keyword_id 제거
      );
    }

    logger.info(`[INFO] 키워드 "${keywordName}" (${current}/${total}) - placeId=${placeId} 상세크롤 완료`);
    return { detailInfo, success: true };
  } catch (err) {
    logger.error(`[ERROR] 키워드 "${keywordName}" (${current}/${total}) - placeId=${placeId} 상세크롤 실패:`, err);
    throw err;
  }
}

// crawlKeywordDetail 함수 내 병렬 처리 부분 수정
export async function crawlKeywordDetail(keywordId, batchSize = 100) {
  logger.info(`[INFO][DetailCrawler] keywordId=${keywordId} 에 대한 디테일 크롤링 시작`);
  
  // 처리 통계
  const stats = {
    total: 0,
    success: 0,
    failed: 0,
    retried: 0,
    finalFailed: 0
  };
  
  // 키워드 정보 확인
  const keyword = await Keyword.findByPk(keywordId);
  if (!keyword) {
    logger.error(`[ERROR] 키워드 ID ${keywordId}를 찾을 수 없습니다.`);
    return;
  }
  
  const keywordName = keyword.keyword; // 키워드 이름 저장
  
  const { ua, cookieStr } = loadMobileUAandCookies();
  
  // 수정: 필드명 확인 및 쿼리 수정
  // 컬럼 이름이 다를 수 있으므로 아래 두 가지 방법을 시도
  let existingDetailCount = 0;
  try {
    // 방법 1: keywordId로 시도
    existingDetailCount = await PlaceDetailResult.count({
      where: { keywordId: keywordId }
    });
    logger.info(`[INFO] 키워드 "${keywordName}" (ID: ${keywordId})에 대한 기존 상세 크롤링 결과: ${existingDetailCount}개`);
  } catch (err) {
    try {
      // 방법 2: keyword_id로 시도하지 않고 place_id만으로 검색
      // 기존 place_id 목록 가져오기
      const placeIds = await KeywordBasicCrawlResult.findAll({
        attributes: ['place_id'],
        where: { keyword_id: keywordId }
      }).then(results => results.map(r => r.place_id));
      
      if (placeIds.length > 0) {
        // place_id 배열로 존재하는 상세 정보 카운트
        existingDetailCount = await PlaceDetailResult.count({
          where: { 
            place_id: { [Op.in]: placeIds }
          }
        });
      }
      logger.info(`[INFO] 키워드 "${keywordName}"에 연관된 장소 ID 기반 상세 크롤링 결과: ${existingDetailCount}개`);
    } catch (innerErr) {
      logger.error(`[ERROR] 기존 상세 크롤링 결과 확인 중 오류: ${innerErr.message}`);
      // 계속 진행 - 중요하지 않은 카운트 정보
    }
  }
  
  // 총 레코드 수 확인
  const totalCount = await KeywordBasicCrawlResult.count({
    where: {
      keyword_id: keywordId
    }
  });
  
  logger.info(`[INFO] 키워드 "${keywordName}" (ID: ${keywordId})에 대한 총 ${totalCount}개 장소 정보가 있습니다.`);
  
  // 처리된 항목 수 카운터
  let processedCount = 0;
  let globalItemCounter = 0; // 전체 진행 항목 카운터
  
  // 데이터베이스에 실제 존재하는 필드만 요청
  const validAttributes = ['place_id', 'keyword_id', 'place_name'];
  try {
    validAttributes = await getValidAttributes(KeywordBasicCrawlResult, validAttributes);
  } catch (err) {
    logger.warn(`[WARN] 속성 검증 중 오류, 기본 속성 사용: ${err.message}`);
    // 오류 발생 시 기본 속성 그대로 사용
  }
  // 계속 루프 돌면서 처리
  while (processedCount < totalCount) {
    // 여기도 PlaceDetailResult의 필드명과 관련된 쿼리 수정
    const rows = await KeywordBasicCrawlResult.findAll({
      where: {
        keyword_id: keywordId
      },
      limit: batchSize,
      attributes: validAttributes, // 유효한 속성만 사용
      raw: true // 순수 데이터 객체로 반환
    });

    if (rows.length === 0) {
      logger.info(`[INFO][DetailCrawler] 키워드 "${keywordName}" - 더 이상 처리할 place 없음. 종료.`);
      break;
    }

    // 이미 처리된 place_id 필터링
    const processedPlaceIds = await PlaceDetailResult.findAll({
      attributes: ['place_id'],
      where: {
        place_id: { [Op.in]: rows.map(r => r.place_id) }
      },
      raw: true
    }).then(results => new Set(results.map(r => r.place_id)));

    // 아직 처리되지 않은 rows만 필터링
    const unprocessedRows = rows.filter(row => !processedPlaceIds.has(row.place_id));

    if (unprocessedRows.length === 0) {
      logger.info(`[INFO][DetailCrawler] 키워드 "${keywordName}" - 모든 place가 이미 처리됨. 종료.`);
      break;
    }

    logger.info(`[INFO][DetailCrawler] 키워드 "${keywordName}" - 처리 대상 ${unprocessedRows.length}개 (전체 ${totalCount}개 중 ${processedCount + 1}-${Math.min(processedCount + unprocessedRows.length, totalCount)}번째 처리)`);
    stats.total += unprocessedRows.length;

    // 실패한 항목을 저장할 배열
    const failedItems = [];

    // 병렬 처리를 위한 배치 사이즈
    const parallelBatchSize = 7;

    // 배치 단위로 병렬 처리
    for (let i = 0; i < unprocessedRows.length; i += parallelBatchSize) {
      const batch = unprocessedRows.slice(i, i + parallelBatchSize);
      logger.info(`[INFO] 키워드 "${keywordName}" - 병렬 처리 배치: ${processedCount + i + 1}-${processedCount + i + batch.length}/${totalCount} (${((processedCount + i + batch.length) / totalCount * 100).toFixed(1)}%)`);
      
      const promises = batch.map(async (row, idx) => {
        globalItemCounter++;
        const currentItemNumber = processedCount + i + idx + 1;
        
        // 진행 정보 객체
        const progressInfo = {
          keywordName,
          current: currentItemNumber,
          total: totalCount,
          percent: ((currentItemNumber / totalCount) * 100).toFixed(1)
        };
        
        try {
          await crawlAndUpdatePlace(row, cookieStr, ua, progressInfo);
          stats.success++;
          processedCount++;
          return { success: true, row };
        } catch (err) {
          logger.error(`[ERROR] 키워드 "${keywordName}" (${currentItemNumber}/${totalCount}) - placeId=${row.place_id} 상세크롤 실패:`, err);
          failedItems.push({row, progressInfo});    
          return { success: false, row, error: err };
        }
      });

      // 병렬 실행 결과 기다리기
      await Promise.all(promises);
      await randomDelay(0.6, 1);
    }

    // 실패한 항목이 있으면 재시도 로직 실행 (재시도 로직도 유사하게 수정)
    if (failedItems.length > 0) {
      logger.info(`[INFO] 키워드 "${keywordName}" - 1차 실패: ${failedItems.length}개 항목 재시도`);
      stats.failed += failedItems.length;
      // 1차 재시도 실패 항목 저장
      const firstRetryFailedItems = [];
      
      // 병렬 처리를 위한 1차 재시도 배치 크기 설정
      const retryParallelBatchSize = 5;
      
      // 1차 재시도: 배치 단위로 병렬 처리
      for (let i = 0; i < failedItems.length; i += retryParallelBatchSize) {
        const retryBatch = failedItems.slice(i, i + retryParallelBatchSize);
        logger.info(`[INFO] 1차 재시도 배치: ${i} ~ ${i + retryBatch.length - 1}`);
        
        const retryPromises = retryBatch.map(async (item) => {
          // item.row가 없으면 item 자체를 row로 사용
          const row = item.row || item;
          const progressInfo = item.progressInfo || {};
          
          // place_id 확인
          const placeId = row?.place_id;
          
          if (!placeId) {
            logger.error('[ERROR] place_id가 없는 항목 건너뜀:', item);
            firstRetryFailedItems.push(item);
            return { success: false };
          }
          
          try {
            await randomDelay(0.5, 1.5);
            await crawlAndUpdatePlace(row, cookieStr, ua, progressInfo);
            logger.info(`[INFO] placeId=${placeId} 상세크롤 재시도 완료`);
            stats.success++;
            processedCount++;
            return { success: true, row };
          } catch (err) {
            logger.error(`[ERROR] placeId=${placeId} 1차 재시도 실패:`, err);
            firstRetryFailedItems.push(item);
            return { success: false, row, error: err };
          }
        });
        
        // 병렬 실행 결과 기다리기
        await Promise.all(retryPromises);
      }

      // 2차 재시도 처리
      if (firstRetryFailedItems.length > 0) {
        logger.info(`[INFO] 키워드 "${keywordName}" - 2차 재시도: ${firstRetryFailedItems.length}개 항목`);
        const secondRetryFailedItems = [];
        
        for (const item of firstRetryFailedItems) {
          if (!item || !item.row) {
            logger.error('[ERROR] 유효하지 않은 2차 재시도 항목:', item);
            continue;
          }
          
          const { row, progressInfo } = item;
          const placeId = row?.place_id;
          
          if (!placeId) {
            logger.error('[ERROR] 2차 재시도 - place_id가 없는 항목 건너뜀');
            secondRetryFailedItems.push(item); // 최종 실패 항목으로 추가
            continue;
          }
          
          try {
            await randomDelay(1.5, 2.5);
            await crawlAndUpdatePlace(row, cookieStr, ua, progressInfo);
            logger.info(`[INFO] placeId=${placeId} 2차 재시도 성공`);
            stats.retried++;
            processedCount++;
          } catch (err) {
            logger.error(`[ERROR] placeId=${placeId} 2차 재시도 실패:`, err);
            secondRetryFailedItems.push(item); // 원본 객체 구조 유지
          }
        }

        // 3차 재시도 부분 수정
        if (secondRetryFailedItems.length > 0) {
          logger.info(`[INFO] 키워드 "${keywordName}" - 3차(최종) 재시도: ${secondRetryFailedItems.length}개 항목`);
          
          for (const item of secondRetryFailedItems) {
            if (!item || !item.row) {
              logger.error('[ERROR] 유효하지 않은 3차 재시도 항목:', item);
              stats.finalFailed++;
              continue;
            }
            
            const { row, progressInfo } = item;
            const placeId = row?.place_id;
            
            if (!placeId) {
              logger.error('[ERROR] 3차 재시도 - place_id가 없는 항목 건너뜀');
              stats.finalFailed++;
              continue;
            }
            
            try {
              await randomDelay(2, 3);
              await crawlAndUpdatePlace(row, cookieStr, ua, progressInfo);
              logger.info(`[INFO] placeId=${placeId} 3차 재시도 성공`);
              stats.retried++;
              processedCount++;
            } catch (err) {
              logger.error(`[ERROR] placeId=${placeId} 최종(3차) 재시도 실패:`, err);
              stats.finalFailed++;
              
              // 에러 메시지 저장
              if (typeof row.save === 'function') {
                row.error_message = err.message.substring(0, 255);
                await row.save();
              } else {
                // 대체 방법으로 업데이트
                await KeywordCrawlResult.update(
                  { error_message: err.message.substring(0, 255) },
                  { where: { place_id: placeId, keyword_id: keywordId } }
                );
              }
            }
          }
        }
      }
    }
    
    // 남은 미처리 항목 수 확인
    const remainingCount = await KeywordBasicCrawlResult.count({
      where: { keyword_id: keywordId },
      include: [{
        model: PlaceDetailResult,
        required: false,
        attributes: ['id'],
        where: {
          place_id: { [Op.col]: 'KeywordBasicCrawlResult.place_id' },
        }
      }],
      having: Sequelize.literal('COUNT(PlaceDetailResult.id) = 0')
    });
    
    // detail_crawled 컬럼이 없으므로 이 부분은 제거
    // 대신 상세 크롤링 완료 상태만 로그로 남김
    if (remainingCount === 0 || (remainingCount <= stats.finalFailed)) {
      logger.info(`[INFO] 키워드 "${keywordName}" (ID: ${keywordId}) 상세 정보 크롤링 완료.`);
    } else {
      logger.info(`[INFO] 키워드 "${keywordName}" (ID: ${keywordId})에 대해 아직 처리되지 않은 항목이 ${remainingCount}개 있습니다.`);
    }

    // 통계 출력에도 키워드 이름 포함
    logger.info(`[INFO][DetailCrawler] 키워드 "${keywordName}" (ID: ${keywordId}) 디테일 크롤링 통계:`);
    logger.info(`- 총 처리: ${stats.total}개`);
    logger.info(`- 성공: ${stats.success}개 (첫 시도)`);
    logger.info(`- 재시도 성공: ${stats.retried}개`);
    logger.info(`- 최종 실패: ${stats.finalFailed}개`);
    logger.info(`- 완료율: ${((stats.success + stats.retried) / totalCount * 100).toFixed(1)}%`);
    
    logger.info(`[INFO][DetailCrawler] 키워드 "${keywordName}" (ID: ${keywordId}) 디테일 크롤링 종료`);
  }
}

/**
 * 모든 미처리 키워드에 대해 상세 크롤링 실행
 */
export async function crawlAllPendingDetails(batchSize = 100) {
  // 수정: 필드명 문제로 인해 로직 단순화
  // 기본 크롤링이 완료된 모든 키워드 조회
  const pendingKeywords = await Keyword.findAll({
    where: {
      basic_last_crawled_date: { [Op.not]: null }
    }
  });
  
  if (pendingKeywords.length === 0) {
    logger.info('[INFO] 기본 크롤링이 완료된 키워드가 없습니다.');
    return;
  }
  
  logger.info(`[INFO] 기본 크롤링이 완료된 키워드가 ${pendingKeywords.length}개 있습니다.`);
  
  // 각 키워드에 대해 순차적으로 디테일 크롤링 실행
  for (const keyword of pendingKeywords) {
    logger.info(`[INFO] 키워드 "${keyword.keyword}" (ID: ${keyword.id})에 대한 상세 크롤링 시작...`);
    await crawlKeywordDetail(keyword.id, batchSize);
    
    // 각 키워드 사이에 딜레이 추가
    await randomDelay(2, 5);
  }
  
  logger.info('[INFO] 모든 대기 중인 키워드의 상세 크롤링이 완료되었습니다.');
}

// 직접 실행 예시
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  (async () => {
    const [,, keywordId, mode] = process.argv;
    
    if (mode === 'all') {
      logger.info('[INFO] 모든 대기 중인 키워드의 상세 크롤링을 시작합니다...');
      await crawlAllPendingDetails();
    } else if (keywordId) {
      const id = parseInt(keywordId, 10);
      if (!isNaN(id)) {
        logger.info(`[INFO] 키워드 ID ${id}의 상세 크롤링을 시작합니다...`);
        await crawlKeywordDetail(id);
      } else {
        logger.error('[ERROR] 유효한 keywordId를 입력하세요.');
      }
    } else {
      logger.error('[ERROR] 사용법: node detailCrawlerService.js <keywordId | "all">');
      logger.error('예시: node detailCrawlerService.js 123');
      logger.error('예시: node detailCrawlerService.js all');
    }
    
    process.exit(0);
  })();
}
