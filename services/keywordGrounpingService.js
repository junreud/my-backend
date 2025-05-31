/******************************************************
 * keywordGrounpingService.js
 *  - Puppeteer로 모바일(또는 PC) 네이버 페이지를 직접 열어 크롤링
 *  - 병렬 처리로 성능 향상
 *  - 공통 설정/함수는 crawler.js에서 import
 ******************************************************/
import puppeteer from "puppeteer";
import {createLogger} from '../lib/logger.js';

const logger = createLogger('KeywordGroupingService');
// (★) crawler.js에서 가져오는 부분
import {
  loadMobileUAandCookies,
  getRandomCoords,
  randomDelay
} from "../config/crawler.js";

// Add imports for models
import Keyword from '../models/Keyword.js';
import SameResultKeyword from '../models/SameResultKeyword.js';

/**
 * (A) Puppeteer: 네이버에서 키워드 검색 → 상위 20개 업체명 추출
 *     (모바일 or PC를 cookie + UA로 일치)
 */
async function crawlTop20NaverResults(page, keyword) {
  // 1) 무작위 좌표
  const baseX = 126.977;
  const baseY = 37.5665;
  const { randX, randY } = getRandomCoords(baseX, baseY, 300);

  // 2) 네이버 검색 URL (모바일 구조 사용)
  const url = `https://m.place.naver.com/place/list?query=${encodeURIComponent(
    keyword
  )}&x=${randX}&y=${randY}&level=top&entry=pll`;
  logger.info(`>>> [${keyword}] final search URL:`, url);

  // 3) 페이지 이동
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // 4) 특정 셀렉터 대기
  try {
    await page.waitForSelector("h1#_header.bh9OH", { timeout: 8000 });
  } catch {
    logger.warn(`[WARN] 셀렉터를 찾지 못했습니다. keyword=${keyword}`);
  }

  // 5) 모든 업체 목록 li.VLTHu
  const allItems = await page.$$("li.VLTHu");
  logger.debug(`[DEBUG] ${keyword} - Found ${allItems.length} total items`);

  // (6) 광고 제외 (data-laim-exp-id !== 'undefined')
  const realItems = [];
  for (const li of allItems) {
    const laimExpId = await li.evaluate((el) =>
      el.getAttribute("data-laim-exp-id")
    );
    if (laimExpId === "undefined") {
      realItems.push(li);
    }
  }
  logger.debug(`[DEBUG] ${keyword} - Found ${realItems.length} non-ad items`);

  // 최대 20개만
  const topItems = realItems.slice(0, 20);

  // (7) 각 아이템에서 업체명 추출 (.YwYLL)
  const top20Names = [];
  for (const item of topItems) {
    try {
      const name = await item.$eval(".YwYLL", (el) => el.textContent.trim());
      top20Names.push(name);
    } catch (err) {
      logger.warn(`[WARN] ${keyword} - Failed to extract name for an item:`, err.message);
    }
  }
  
  logger.debug(`[DEBUG] ${keyword} - Successfully extracted ${top20Names.length} business names`);
  return top20Names;
}

/**
 * (D) 동일한 Top10 결과를 그룹화
 */
function groupByTop10(list) {
  // 1. Debug: Print input list to see what we're grouping
  logger.debug(`[DEBUG] groupByTop10 input list (${list.length} items):`, 
    list.map(item => ({
      keyword: item.keyword,
      top10Length: item.top10?.length || 0,
    }))
  );
  
  const map = new Map();
  
  // Group tracking for debugging
  const signatureMap = {};

  list.forEach((item) => {
    // Validate top10 array - must have actual values to group properly
    if (!Array.isArray(item.top10) || item.top10.length < 3) {
      logger.warn(`[WARN] Skipping item with invalid top10 array: ${item.keyword}`);
      return;
    }
    
    // Create a unique signature from the top results
    const signature = item.top10.slice(0, 10).join("|");
    
    // Track which keyword was mapped to which signature for debugging
    if (!signatureMap[signature]) {
      signatureMap[signature] = [];
    }
    signatureMap[signature].push(item.keyword);
    
    // Start new group or add to existing
    if (!map.has(signature)) {
      map.set(signature, {
        top10: item.top10.slice(0, 10), // 그룹화에는 상위 10개만 사용
        items: [],
      });
    }
    
    // Simply add to group (no size limit)
    map.get(signature).items.push({
      rank: item.rank,
      keyword: item.keyword,
      monthlySearchVolume: item.monthlySearchVolume,
    });
  });
  
  // Print debug info about the grouping
  logger.debug('[DEBUG] Signature grouping results:');
  Object.keys(signatureMap).forEach(sig => {
    logger.debug(`Signature: ${sig.substring(0, 40)}... has ${signatureMap[sig].length} keywords: ${signatureMap[sig].join(', ')}`);
  });

  // Convert map to array and return
  const result = Array.from(map.values());
  logger.debug(`[DEBUG] Created ${result.length} keyword groups`);
  return result;
}

/**
 * 단일 키워드 처리 함수 - 재시도 메커니즘 포함
 */
async function processKeyword(item) {
  const { rank, keyword, monthlySearchVolume } = item;
  let browser = null;
  let retryAttempt = 0;
  const maxRetries = 1; // 1회만 재시도
  
  // 재시도 딜레이를 지수적으로 증가
  const getBackoffTime = (attempt) => Math.min(2000 * Math.pow(1.5, attempt), 8000);
  
  while (retryAttempt <= maxRetries) {
    try {
      // 재시도 시 로그 메시지 추가
      if (retryAttempt > 0) {
        logger.info(`[INFO] 재시도 #${retryAttempt} 키워드: "${keyword}"`);
        await randomDelay(1, 2); // 재시도 전 약간의 딜레이
      } else {
        logger.info(`[INFO] Processing keyword: "${keyword}"`);
      }
      
      // 브라우저 실행
      browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        ignoreHTTPSErrors: true
      });
      
      // 페이지 생성 및 설정
      const page = await browser.newPage();
      
      // 성능 최적화: 불필요한 리소스 차단
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'font', 'stylesheet'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
      
      // UA와 쿠키 설정
      const { ua, cookieStr } = loadMobileUAandCookies();
      await page.setUserAgent(ua);
      
      // 쿠키 설정
      const cookieArr = cookieStr.split("; ").map((pair) => {
        const [name, value] = pair.split("=");
        return {
          name,
          value,
          domain: ".naver.com",
          path: "/",
        };
      });
      await page.setCookie(...cookieArr);
      
      // 타임아웃 설정으로 페이지 로딩 시간 제한
      const top20 = await Promise.race([
        crawlTop20NaverResults(page, keyword),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Crawling timeout')), 8000)) // 타임아웃 증가
      ]);
      
      await page.close();
      
      // 결과 확인 및 반환
      if (top20 && top20.length > 0) {
        if (retryAttempt > 0) {
          logger.info(`[INFO] 키워드 "${keyword}" 재시도 후 성공적으로 처리됨`);
        }
        await browser.close();
        browser = null;
        return { rank, keyword, monthlySearchVolume, top10: top20.slice(0, 10) };
      } else {
        logger.warn(`[WARN] No results found for keyword "${keyword}"`);
        throw new Error('No results found');
      }
    } catch (err) {
      // 브라우저 정리
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          logger.error(`[ERROR] Browser close error for "${keyword}":`, closeErr.message);
        }
        browser = null;
      }
      
      // 재시도 로직 개선
      if (retryAttempt < maxRetries) {
        const backoffTime = getBackoffTime(retryAttempt);
        logger.warn(`[WARN] Failed to process keyword "${keyword}" (attempt ${retryAttempt + 1}/${maxRetries + 1}). Retrying in ${backoffTime/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        retryAttempt++;
      } else {
        logger.error(`[ERROR] Failed to process keyword "${keyword}" after ${maxRetries + 1} attempts:`, err.message);
        return null;
      }
    }
  }
  
  return null; // 모든 시도 실패 시
}

/**
 * 병렬 처리를 위한 키워드 배치 처리 함수
 * @param {Array} keywordList - 처리할 키워드 목록
 * @param {number} batchSize - 동시 처리할 키워드 수
 * @returns {Array} - 처리된 결과 배열
 */
async function processBatch(keywordList, batchSize = 2) { // 동시 처리 수 줄임
  const allResults = [];
  const batches = [];
  
  // 시간 초과 방지를 위해 키워드 수 추가 제한
  const MAX_KEYWORDS = 20;
  const limitedList = keywordList.slice(0, MAX_KEYWORDS);
  
  // 키워드 배열을 batchSize 크기의 배치로 나누기
  for (let i = 0; i < limitedList.length; i += batchSize) {
    batches.push(limitedList.slice(i, i + batchSize));
  }
  
  logger.info(`[INFO] Processing ${limitedList.length} keywords in ${batches.length} batches of ${batchSize}`);
  
  // 전체 처리 시간 제한 단축 (15초로 증가)
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Crawling operation timed out')), 15000);
  });
  
  try {
    // 각 배치 처리 - Promise.race로 타임아웃 구현
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.info(`[INFO] Processing batch ${i+1}/${batches.length} with ${batch.length} keywords`);
      
      // 배치별 Promise.allSettled 사용하여 일부 실패해도 계속 진행
      const batchPromise = Promise.allSettled(
        batch.map(item => {
          // 개별 키워드 처리에도 타임아웃 적용 (8초로 증가)
          const keywordTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Keyword ${item.keyword} processing timed out`)), 8000);
          });
          return Promise.race([processKeyword(item), keywordTimeout]);
        })
      );
      
      const batchResults = await Promise.race([batchPromise, timeoutPromise]);
      
      // 결과 처리 - fulfilled 상태인 것만 추출
      const successfulResults = batchResults
        .filter(result => result.status === 'fulfilled' && Boolean(result.value))
        .map(result => result.value);
      
      allResults.push(...successfulResults);
      
      // 배치 간 딜레이 증가 (차단 방지)
      if (i < batches.length - 1) {
        const delayTime = await randomDelay(2, 4); // 딜레이 증가
        logger.info(`[INFO] Batch ${i+1} completed. Waiting ${(delayTime/1000).toFixed(1)} seconds before next batch...`);
      }
    }
  } catch (err) {
    logger.error(`[ERROR] Batch processing error: ${err.message}`);
    // 지금까지 수집된 결과로 진행 (일부 결과라도 반환)
    logger.info(`[INFO] Returning partial results (${allResults.length} items)`);
  }
  
  return allResults;
}

/**
 * (E) Puppeteer 병렬 처리 방식으로 키워드 목록을 처리
 */
export async function groupKeywordsByNaverTop10(keywordList) {
  try {
    logger.info(`[INFO] Starting parallel Puppeteer processing for ${keywordList.length} keywords`);
    
    // 병렬 처리 (기본 3개 동시 처리)
    const concurrencyLevel = 3; // 동시 실행 브라우저 수
    const results = await processBatch(keywordList, concurrencyLevel);
    
    logger.info(`[INFO] Successfully processed ${results.length}/${keywordList.length} keywords`);
    
    // 유효한 결과 필터링
    const validResults = results.filter(item => 
      item && Array.isArray(item.top10) && item.top10.length >= 3
    );
    
    logger.info(`[INFO] ${validResults.length}/${results.length} keywords have valid results for grouping`);

    // 그룹화
    const grouped = groupByTop10(validResults);

    // Persist same-result keyword relationships
    try {
      for (const group of grouped) {
        // extract keyword strings from combinedKeyword or from group.items
        const keywords = group.items.map(i => i.keyword);
        // fetch keyword records
        const keywordRecords = await Keyword.findAll({ where: { keyword: keywords } });
        const idMap = keywordRecords.reduce((acc, k) => { acc[k.keyword] = k.id; return acc; }, {});
        // create unique pairs
        for (let i = 0; i < keywords.length; i++) {
          for (let j = i + 1; j < keywords.length; j++) {
            const id1 = idMap[keywords[i]];
            const id2 = idMap[keywords[j]];
            if (!id1 || !id2) continue;
            const [kwA, kwB] = id1 < id2 ? [id1, id2] : [id2, id1];
            await SameResultKeyword.findOrCreate({
              where: { keyword_id: kwA, related_keyword_id: kwB }
            });
          }
        }
      }
      logger.info(`[INFO] Saved ${grouped.length} same-result keyword groups to DB`);
    } catch (dbErr) {
      logger.error('[ERROR] saving same-result keyword relations:', dbErr.message);
    }

    // 반환 데이터 형식 구성
    return grouped.map((group) => {
      const combinedKeyword = group.items.map((i) => i.keyword).join(", ");
      const details = group.items.map((i) => ({
        rank: i.rank,
        monthlySearchVolume: i.monthlySearchVolume,
      }));
      return { combinedKeyword, details };
    });
  } catch (err) {
    logger.error("[ERROR] groupKeywordsByNaverTop10:", err);
    return [];
  }
}