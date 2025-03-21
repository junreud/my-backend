// detailCrawler.js
import { Op } from 'sequelize';
import KeywordCrawlResult from '../../models/KeywordCrawlResult.js';
import Keyword from '../../models/Keyword.js';
import { fetchDetailHtml, parseDetailHtml } from './crawlerAxios.js';
import { updateKeywordDetailCrawled } from './dbHelpers.js';
import { 
  randomDelay, 
  loadMobileUAandCookies 
} from '../../config/crawler.js';
import puppeteer from 'puppeteer';


/**
 * 디테일(상세) 크롤링:
 *   1) keyword 테이블에서 detail_crawled=false인 키워드 찾기
 *   2) 해당 키워드에 대한 모든 place 정보 가져오기
 *   3) placeId마다 fetchDetailHtml -> parseDetailHtml (7개씩 병렬 처리)
 *   4) DB update (blog_review_count, receipt_review_count, keywordList)
 *   5) 실패한 항목에 대해 2회까지 재시도
 *   6) 모든 처리가 완료되면 keyword 테이블의 detail_crawled=true로 업데이트
 */
async function crawlAndUpdatePlace(row, cookieStr, ua, progressInfo = {}) {
  // 기본값 설정으로 undefined 오류 방지
  const { keywordName = "알 수 없음", current = 0, total = 0 } = progressInfo;
  const placeId = row?.place_id || "알 수 없음";
  
  // 향상된 로그 메시지
  console.log(`[INFO] 키워드 "${keywordName}" (${current}/${total}) - placeId=${placeId} 크롤링 시작`);
  
  // 유효성 검사 추가
  if (!row || !placeId || placeId === "알 수 없음") {
    throw new Error("유효하지 않은 row 객체: place_id가 없거나 올바르지 않습니다.");
  }
  
  const detailHtml = await fetchDetailHtml(
    placeId, 
    cookieStr, 
    ua, 
    row.is_restaurant === true
  );
  const detailInfo = parseDetailHtml(detailHtml);

  // DB 업데이트
  row.blog_review_count = detailInfo.blogReviewCount ?? 0;
  row.receipt_review_count = detailInfo.visitorReviewCount ?? 0;
  row.keywordList = Array.isArray(detailInfo.keywordList) 
    ? JSON.stringify(detailInfo.keywordList)
    : null;
  
  // row.save가 함수인지 확인 후 호출
  if (typeof row.save === 'function') {
    await row.save();
  } else {
    console.error(`[ERROR] row.save is not a function for placeId=${placeId}`);
    // 대체 방법으로 업데이트 수행 (실제 구현 필요)
    await KeywordCrawlResult.update(
      {
        blog_review_count: row.blog_review_count,
        receipt_review_count: row.receipt_review_count,
        keywordList: row.keywordList
      },
      { where: { place_id: placeId, keyword_id: row.keyword_id } }
    );
  }
  
  console.log(`[INFO] 키워드 "${keywordName}" (${current}/${total}) - placeId=${placeId} 상세크롤 완료`);
  return { detailInfo };
}

// crawlKeywordDetail 함수 내 병렬 처리 부분 수정
export async function crawlKeywordDetail(keywordId, batchSize = 100) {
  console.log(`[INFO][DetailCrawler] keywordId=${keywordId} 에 대한 디테일 크롤링 시작`);
  
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
    console.error(`[ERROR] 키워드 ID ${keywordId}를 찾을 수 없습니다.`);
    return;
  }
  
  const keywordName = keyword.keyword; // 키워드 이름 저장
  
  // 이미 detail_crawled=true인 경우 처리하지 않음
  if (keyword.detail_crawled) {
    console.log(`[INFO] 키워드 "${keywordName}" (ID: ${keywordId})는 이미 detail_crawled=true 상태입니다. 처리를 건너뜁니다.`);
    return;
  }
  
  const { ua, cookieStr } = loadMobileUAandCookies();
  
  // 해당 키워드의 모든 장소 정보 조회
  const totalCount = await KeywordCrawlResult.count({
    where: { keyword_id: keywordId }
  });
  
  if (totalCount === 0) {
    console.log(`[INFO] 키워드 "${keywordName}" (ID: ${keywordId})에 대한 장소 정보가 없습니다.`);
    return;
  }
  
  console.log(`[INFO] 키워드 "${keywordName}" (ID: ${keywordId})에 대한 총 ${totalCount}개 장소 정보가 있습니다.`);
  
  // 처리된 항목 수 카운터
  let processedCount = 0;
  let globalItemCounter = 0; // 전체 진행 항목 카운터
  
  // 계속 루프 돌면서 처리
  while (processedCount < totalCount) {
    // 아직 처리하지 않은 place를 최대 batchSize개 가져오기
    const rows = await KeywordCrawlResult.findAll({
      where: {
        keyword_id: keywordId,
        [Op.or]: [
          { blog_review_count: 0 },
          { blog_review_count: null }
        ]
      },
      limit: batchSize
    });

    if (rows.length === 0) {
      console.log(`[INFO][DetailCrawler] 키워드 "${keywordName}" - 더 이상 처리할 place 없음. 종료.`);
      break;
    }

    console.log(`[INFO][DetailCrawler] 키워드 "${keywordName}" - 처리 대상 ${rows.length}개 (전체 ${totalCount}개 중 ${processedCount + 1}-${Math.min(processedCount + rows.length, totalCount)}번째 처리)`);
    stats.total += rows.length;

    // 실패한 항목을 저장할 배열
    const failedItems = [];

    // 병렬 처리를 위한 배치 사이즈
    const parallelBatchSize = 7;

    // 배치 단위로 병렬 처리
    for (let i = 0; i < rows.length; i += parallelBatchSize) {
      const batch = rows.slice(i, i + parallelBatchSize);
      console.log(`[INFO] 키워드 "${keywordName}" - 병렬 처리 배치: ${processedCount + i + 1}-${processedCount + i + batch.length}/${totalCount} (${((processedCount + i + batch.length) / totalCount * 100).toFixed(1)}%)`);
      
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
          console.error(`[ERROR] 키워드 "${keywordName}" (${currentItemNumber}/${totalCount}) - placeId=${row.place_id} 상세크롤 실패:`, err);
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
      console.log(`[INFO] 키워드 "${keywordName}" - 1차 실패: ${failedItems.length}개 항목 재시도`);
      stats.failed += failedItems.length;
      // 1차 재시도 실패 항목 저장
      const firstRetryFailedItems = [];
      
      // 병렬 처리를 위한 1차 재시도 배치 크기 설정
      const retryParallelBatchSize = 5;
      
      // 1차 재시도: 배치 단위로 병렬 처리
      for (let i = 0; i < failedItems.length; i += retryParallelBatchSize) {
        const retryBatch = failedItems.slice(i, i + retryParallelBatchSize);
        console.log(`[INFO] 1차 재시도 배치: ${i} ~ ${i + retryBatch.length - 1}`);
        
        const retryPromises = retryBatch.map(async (item) => {
          // item.row가 없으면 item 자체를 row로 사용
          const row = item.row || item;
          const progressInfo = item.progressInfo || {};
          
          // place_id 확인
          const placeId = row?.place_id;
          
          if (!placeId) {
            console.error('[ERROR] place_id가 없는 항목 건너뜀:', item);
            firstRetryFailedItems.push(item);
            return { success: false };
          }
          
          try {
            await randomDelay(0.5, 1.5);
            await crawlAndUpdatePlace(row, cookieStr, ua, progressInfo);
            console.log(`[INFO] placeId=${placeId} 상세크롤 재시도 완료`);
            stats.success++;
            processedCount++;
            return { success: true, row };
          } catch (err) {
            console.error(`[ERROR] placeId=${placeId} 1차 재시도 실패:`, err);
            firstRetryFailedItems.push(item);
            return { success: false, row, error: err };
          }
        });
        
        // 병렬 실행 결과 기다리기
        await Promise.all(retryPromises);
      }

      // 2차 재시도 처리
      if (firstRetryFailedItems.length > 0) {
        console.log(`[INFO] 키워드 "${keywordName}" - 2차 재시도: ${firstRetryFailedItems.length}개 항목`);
        const secondRetryFailedItems = [];
        
        for (const item of firstRetryFailedItems) {
          if (!item || !item.row) {
            console.error('[ERROR] 유효하지 않은 2차 재시도 항목:', item);
            continue;
          }
          
          const { row, progressInfo } = item;
          const placeId = row?.place_id;
          
          if (!placeId) {
            console.error('[ERROR] 2차 재시도 - place_id가 없는 항목 건너뜀');
            secondRetryFailedItems.push(item); // 최종 실패 항목으로 추가
            continue;
          }
          
          try {
            await randomDelay(1.5, 2.5);
            await crawlAndUpdatePlace(row, cookieStr, ua, progressInfo);
            console.log(`[INFO] placeId=${placeId} 2차 재시도 성공`);
            stats.retried++;
            processedCount++;
          } catch (err) {
            console.error(`[ERROR] placeId=${placeId} 2차 재시도 실패:`, err);
            secondRetryFailedItems.push(item); // 원본 객체 구조 유지
          }
        }

        // 3차 재시도 부분 수정
        if (secondRetryFailedItems.length > 0) {
          console.log(`[INFO] 키워드 "${keywordName}" - 3차(최종) 재시도: ${secondRetryFailedItems.length}개 항목`);
          
          for (const item of secondRetryFailedItems) {
            if (!item || !item.row) {
              console.error('[ERROR] 유효하지 않은 3차 재시도 항목:', item);
              stats.finalFailed++;
              continue;
            }
            
            const { row, progressInfo } = item;
            const placeId = row?.place_id;
            
            if (!placeId) {
              console.error('[ERROR] 3차 재시도 - place_id가 없는 항목 건너뜀');
              stats.finalFailed++;
              continue;
            }
            
            try {
              await randomDelay(2, 3);
              await crawlAndUpdatePlace(row, cookieStr, ua, progressInfo);
              console.log(`[INFO] placeId=${placeId} 3차 재시도 성공`);
              stats.retried++;
              processedCount++;
            } catch (err) {
              console.error(`[ERROR] placeId=${placeId} 최종(3차) 재시도 실패:`, err);
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
    const remainingCount = await KeywordCrawlResult.count({
      where: {
        keyword_id: keywordId,
        [Op.or]: [
          { blog_review_count: null }
        ]
      }
    });
    
    // 모든 항목이 처리되었거나 남은 항목이 적으면 detail_crawled=true로 업데이트
    if (remainingCount === 0 || (remainingCount <= stats.finalFailed)) {
      await updateKeywordDetailCrawled(keywordId);
      console.log(`[INFO] 키워드 "${keywordName}" (ID: ${keywordId}) 상세 정보 크롤링 완료. detail_crawled=true로 업데이트됨.`);
    } else {
      console.log(`[INFO] 키워드 "${keywordName}" (ID: ${keywordId})에 대해 아직 처리되지 않은 항목이 ${remainingCount}개 있습니다.`);
      console.log(`[INFO] detail_crawled 상태를 업데이트하지 않습니다.`);
    }

    // 통계 출력에도 키워드 이름 포함
    console.log(`[INFO][DetailCrawler] 키워드 "${keywordName}" (ID: ${keywordId}) 디테일 크롤링 통계:`);
    console.log(`- 총 처리: ${stats.total}개`);
    console.log(`- 성공: ${stats.success}개 (첫 시도)`);
    console.log(`- 재시도 성공: ${stats.retried}개`);
    console.log(`- 최종 실패: ${stats.finalFailed}개`);
    console.log(`- 완료율: ${((stats.success + stats.retried) / totalCount * 100).toFixed(1)}%`);
    
    console.log(`[INFO][DetailCrawler] 키워드 "${keywordName}" (ID: ${keywordId}) 디테일 크롤링 종료`);
  }
}
/**
 * 모든 detail_crawled=false 키워드에 대해 상세 크롤링 실행
 */
export async function crawlAllPendingDetails(batchSize = 100) {
  // detail_crawled=false인 모든 키워드 찾기
  const pendingKeywords = await Keyword.findAll({
    where: {
      basic_crawled: true,   // 기본 크롤링이 완료된 키워드만
      detail_crawled: false  // 상세 크롤링이 아직 안된 키워드
    }
  });
  
  if (pendingKeywords.length === 0) {
    console.log('[INFO] 상세 크롤링이 필요한 키워드가 없습니다.');
    return;
  }
  
  console.log(`[INFO] 상세 크롤링이 필요한 키워드가 ${pendingKeywords.length}개 있습니다.`);
  
  // 각 키워드에 대해 순차적으로 디테일 크롤링 실행
  for (const keyword of pendingKeywords) {
    console.log(`[INFO] 키워드 "${keyword.keyword}" (ID: ${keyword.id})에 대한 상세 크롤링 시작...`);
    await crawlKeywordDetail(keyword.id, batchSize);
    
    // 각 키워드 사이에 딜레이 추가
    await randomDelay(2, 5);
  }
  
  console.log('[INFO] 모든 대기 중인 키워드의 상세 크롤링이 완료되었습니다.');
}

// 직접 실행 예시
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  (async () => {
    const [,, keywordId, mode] = process.argv;
    
    if (mode === 'all') {
      console.log('[INFO] 모든 대기 중인 키워드의 상세 크롤링을 시작합니다...');
      await crawlAllPendingDetails();
    } else if (keywordId) {
      const id = parseInt(keywordId, 10);
      if (!isNaN(id)) {
        console.log(`[INFO] 키워드 ID ${id}의 상세 크롤링을 시작합니다...`);
        await crawlKeywordDetail(id);
      } else {
        console.error('[ERROR] 유효한 keywordId를 입력하세요.');
      }
    } else {
      console.error('[ERROR] 사용법: node detailCrawlerService.js <keywordId | "all">');
      console.error('예시: node detailCrawlerService.js 123');
      console.error('예시: node detailCrawlerService.js all');
    }
    
    process.exit(0);
  })();
}