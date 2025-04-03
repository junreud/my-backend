// basicCrawler.js
import { checkIsRestaurantByDOM } from "../isRestaurantChecker.js";
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import {
  getRandomCoords,
  randomDelay,
  loadMobileUAandCookies,
  PROXY_SERVER
} from '../../config/crawler.js';
import KeywordBasicCrawlResult from '../../models/KeywordBasicCrawlResult.js';
import Keyword from '../../models/Keyword.js'; // Keyword 모델 추가
import { createLogger } from '../../lib/logger.js';
import PlaceDetailResult from '../../models/PlaceDetailResult.js';
import { Op } from 'sequelize';
import { keywordQueue } from "./keywordQueue.js";
import sequelize from '../../config/db.js'; 
const logger = createLogger('BasicCrawlerServiceLogger', { service: 'crawler' });

//TODO : 로그 수정 전체적으로 하기


/**
 * 키워드의 basic_last_crawled_date 갱신 (성공시만 동작하게 임의 설정해야함)
 */
async function updateKeywordBasicCrawled(keywordId) {
  try {
    const keyword = await Keyword.findByPk(keywordId);
    if (keyword) {
      await keyword.update({
        basic_last_crawled_date: new Date() // 현재 시간으로 업데이트
      });
      logger.info(` 키워드 ID ${keywordId} basic_last_crawled_date 업데이트 성공`);
      return true;
    }
    return false;
  } catch (err) {
    logger.error(`[ERROR] 키워드 ID ${keywordId} basic_last_crawled_date 업데이트 중 오류:`, err);
    return false;
  }
}
/**
 * 무한 스크롤에서 광고 제외 항목의 증가 패턴을 분석하여 최적화된 스크롤링을 수행합니다.
 * 100의 배수가 아닌 중간에서 끊어지면 추가 로딩이 없다고 판단합니다.
 */
async function performInfiniteScroll(page, itemSelector, maxItems = 300) {
  const scrollSel = '#_list_scroll_container';
  const MAX_ITERATION = 30; // 최대 반복 횟수
  const MAX_NOCHANGE = 5;   // 연속 변화 없음 횟수 제한
  
  let iteration = 0;
  let noChangeCount = 0;
  let previousCount = 0;
  let previousFilteredCount = 0; // 광고 제외 이전 개수

  logger.info(' 무한 스크롤 시작');

  while (true) {
    iteration++;

    // 스크롤 맨 아래로 이동
    await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      if (container) {
        container.scrollTo(0, container.scrollHeight);
      }
    }, scrollSel);

    // 전체 항목 수와 광고 제외 항목 수 모두 확인
    const counts = await page.evaluate((selector) => {
      const elements = document.querySelectorAll(selector);
      const total = elements.length;
      
      // 광고 제외 개수 카운트
      const filtered = Array.from(elements).filter(el => {
        const laimExpId = el.getAttribute('data-laim-exp-id');
        return laimExpId !== 'undefined*e'; // 광고 아닌 것만 포함
      }).length;
      
      return { total, filtered };
    }, itemSelector);
    
    const currentCount = counts.total;
    const filteredCount = counts.filtered;

    // 로그에 총 개수와 광고 제외 개수 모두 표시
    logger.debug(`[DEBUG] 스크롤 #${iteration}: 총 ${currentCount}개 (광고 제외 ${filteredCount}개)`);

    // 조건 1: 최대 항목 수 도달 시 중단
    if (filteredCount >= maxItems) {
      logger.info(` 목표 아이템 수(${maxItems}개) 도달! 광고 제외 ${filteredCount}개`);
      break;
    }

    // 조건 2: 광고 제외 개수가 100단위가 아니고 20개 이상인 경우 (예: 83, 172, 236...)
    // 그리고 이전과 비교해 변화가 있었지만 로딩이 완료된 것으로 판단
    if (filteredCount >= 20 && 
        filteredCount !== 100 && 
        filteredCount !== 200 && 
        filteredCount !== 300 &&
        filteredCount > previousFilteredCount) {
      
      // 나머지를 계산하여 100의 배수가 아닌지 확인
      const remainder = filteredCount % 100;
      if (remainder > 0 && remainder < 90) { // 100의 배수로부터 90개 미만 차이나면 로딩 완료로 간주
        logger.info(` 광고 제외 ${filteredCount}개 (100단위 아님) - 추가 로딩 없을 것으로 판단하고 중단`);
        break;
      }
    }
    // 잠시 지연 (네트워크/DOM 로딩 대기)
    await randomDelay(1, 1.3);
    
    // 다시 체크
    const newCounts = await page.evaluate((selector) => {
      const elements = document.querySelectorAll(selector);
      const total = elements.length;
      const filtered = Array.from(elements).filter(el => {
        const laimExpId = el.getAttribute('data-laim-exp-id');
        return laimExpId !== 'undefined*e';
      }).length;
      return { total, filtered };
    }, itemSelector);
    
    const newCount = newCounts.total;
    const newFilteredCount = newCounts.filtered;

    // 개수 변화 확인
    if (newCount > previousCount || newFilteredCount > previousFilteredCount) {
      logger.debug(`[DEBUG] 아이템 증가: ${previousCount}→${newCount} (광고 제외: ${previousFilteredCount}→${newFilteredCount})`);
      previousCount = newCount;
      previousFilteredCount = newFilteredCount;
      noChangeCount = 0;
    } else {
      noChangeCount++;
      logger.debug(`[DEBUG] 변화 없음 ${noChangeCount}회: ${newCount}개 (광고 제외 ${newFilteredCount}개)`);
    }

    // 반복 제한 또는 연속 변화 없음 횟수 초과 시 중단
    if (iteration >= MAX_ITERATION || noChangeCount >= MAX_NOCHANGE) {
      logger.info(` 스크롤 중단 조건 도달: 반복=${iteration}, 연속변화없음=${noChangeCount}`);
      break;
    }
  }

  // 최종 카운트 보고
  const finalCounts = await page.evaluate((selector) => {
    const elements = document.querySelectorAll(selector);
    const total = elements.length;
    const filtered = Array.from(elements).filter(el => {
      const laimExpId = el.getAttribute('data-laim-exp-id');
      return laimExpId !== 'undefined*e';
    }).length;
    return { total, filtered };
  }, itemSelector);

  logger.info(` 무한 스크롤 종료: 총 ${finalCounts.total}개 아이템 중 유효 ${finalCounts.filtered}개 (광고 제외)`);
  
  return finalCounts.filtered; // 광고 제외 개수 반환
}

/**
 * 
 * @param {*} keyword 
 * @param {*} keywordId 
 * @param {*} baseX 
 * @param {*} baseY 
 * @returns 
 *  - items: 크롤링 결과 항목 배열
 *  - KeywordCrawlResult 테이블에 결과 저장
 *  - Keyword 테이블에 새 키워드 생성
 *  - isRestaurant 값은 isRestaurantChecker.js로부터 가져옴
 */
export async function crawlKeywordBasic(keyword, keywordId, baseX = 126.9783882, baseY = 37.5666103) {
  let browser;
  let page;
  let keywordText = keyword; 

  try {
    // 1) 키워드 정보 확인
    let keywordObj;
    
    if (keywordId) {
      keywordObj = await Keyword.findByPk(keywordId);
      if (!keywordObj) {
        logger.error(`[ERROR] 키워드 ID ${keywordId}를 찾을 수 없습니다.`);
        throw new Error(`키워드 ID ${keywordId}를 찾을 수 없습니다.`);
      }
      keywordText = keywordObj.keyword;
    } else {
      // 키워드 이름으로 검색
      keywordObj = await Keyword.findOne({ where: { keyword: keywordText } });
      
      if (!keywordObj) {
        await checkIsRestaurantByDOM(keywordText);
        // 생성 후 다시 조회
        keywordObj = await Keyword.findOne({ where: { keyword: keywordText } });
        
        if (!keywordObj) {
          logger.error(`[ERROR] 키워드 "${keywordText}" 생성 실패 또는 조회 실패`);
          throw new Error(`키워드 "${keywordText}" 처리 중 오류가 발생했습니다.`);
        }
        logger.info(` 새 키워드 "${keywordText}" 생성됨, ID: ${keywordObj.id}`);
      } else {
        // 기존 코드 유지: 오늘 날짜 14시 기준 확인
        const now = new Date();
        const today14h = new Date(now);
        today14h.setHours(14, 0, 0, 0);
        
        if (keywordObj.basic_last_crawled_date) {
          const lastCrawled = new Date(keywordObj.basic_last_crawled_date);
          if (lastCrawled >= today14h && now >= today14h) {
            logger.info(` 키워드 "${keywordText}"는 이미 오늘 14시 이후에 크롤링되었습니다. 처리를 건너뜁니다.`);
            return [];
          }
        }
      }
      keywordId = keywordObj.id;
    }

    logger.info(`[BasicCrawler] 키워드 "${keywordText}" 기본 크롤링 시작`);

    const isRestaurantVal = keywordObj.isRestaurant ? 1 : 0;
    logger.debug(`[DEBUG] isRestaurantVal=${isRestaurantVal}`);

    // Puppeteer 옵션
    const launchOptions = {
      headless: 'new',
      args: []
    };
    if (PROXY_SERVER) {
      launchOptions.args.push(`--proxy-server=${PROXY_SERVER}`);
      logger.info(' 프록시 사용:', PROXY_SERVER);
    }
    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();

    // 무작위 좌표
    const { randX, randY } = getRandomCoords(baseX, baseY, 300);
    logger.debug(`[DEBUG] 무작위 좌표: (x=${randX.toFixed(7)}, y=${randY.toFixed(7)})`);

    // 2) 검색 URL - 맛집 여부에 따라 경로 조정
    const encodedKeyword = encodeURIComponent(keywordText);
    const route = isRestaurantVal === 1 ? 'restaurant' : 'place';

    let placeUrl = `https://m.place.naver.com/${route}/list?query=${encodedKeyword}&x=${randX}&y=${randY}&level=top&entry=pll`;
    logger.debug(`[DEBUG] 기본 정보 URL: ${placeUrl}`);
  
    // 쿠키와 UA 설정
    const { ua, cookieStr } = loadMobileUAandCookies();
    await page.setUserAgent(ua);

    const cookieArr = cookieStr.split('; ').map(pair => {
      const [name, value] = pair.split('=');
      return { name, value, domain: '.naver.com', path: '/' };
    });
    await page.setCookie(...cookieArr);

    // 페이지 이동
    logger.info(' 페이지 이동:', placeUrl);
    await page.goto(placeUrl, { waitUntil: 'domcontentloaded' });

    // 목록 셀렉터
    logger.info(` ${isRestaurantVal === 1 ? '레스토랑' : '일반 장소'} 모드로 목록 셀렉터 확인`);
    let listItemSelector = isRestaurantVal ? 'li.UEzoS' : 'li.VLTHu';
    logger.info(` 선택된 목록 셀렉터: ${listItemSelector}`);

    // 셀렉터 대기
    try {
      // Mapbox 캔버스 대기 추가
      logger.info(' 맵박스 캔버스 대기 중... (최대 15초)');
      await page.waitForSelector('canvas.mapboxgl-canvas', { 
        timeout: 15000,
        visible: true  // 실제로 화면에 보이는지 확인
      });
      logger.info(' 맵박스 캔버스 로딩 완료');
      
      // 잠시 대기하여 맵이 완전히 렌더링되도록 함
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas.mapboxgl-canvas');
        return canvas && canvas.width > 0 && canvas.height > 0;
      }, { timeout: 5000 });
      logger.info(' 맵박스 캔버스 렌더링 확인 완료');
      
      const count = await page.$$eval(listItemSelector, els => els.length);
      logger.info(` ${listItemSelector} 셀렉터로 ${count}개 항목 발견됨`);
    } catch (err) {
      logger.error('[ERROR] canvas.mapboxgl-canvas 로딩 실패:', err);
      throw new Error('Mapbox canvas failed to load - aborting crawl');
    }
    await randomDelay(1, 1.5);
    // 무한 스크롤
    await performInfiniteScroll(page, listItemSelector);

    // 목록 아이템 추출
    const items = await page.$$eval(listItemSelector, (els, maxCount, isRestaurant) => {
      // // 광고 아닌 요소만 미리 필터링
      const filteredElements = Array.from(els).filter(el => {
        const laimExpId = el.getAttribute('data-laim-exp-id');
        return laimExpId !== 'undefined*e'; // 광고 아닌 것만 포함
      });
      
      const results = [];
      // filteredElements 사용
      for (let i = 0; i < filteredElements.length && results.length < maxCount; i++) {
        const el = filteredElements[i];
        const aTag = el.querySelector('a');
        if (!aTag) continue;
        
        const href = aTag.getAttribute('href') || '';
        let exPlaceId = '';
        
        const m = href.match(/\/(?:restaurant|place|cafe)\/(\d+)/);
        if (m && m[1]) {
          exPlaceId = m[1];
        }
    
        let nameEl, catEl;
        if (isRestaurant) {
          nameEl = el.querySelector('span.TYaxT');
          catEl = el.querySelector('.KCMnt');
        } else {
          nameEl = el.querySelector('span.place_bluelink, span.TYaxT, span._3Apve');
          catEl = el.querySelector('.KCMnt, .OXiLu, ._3hCbH');
        }
        
        const name = nameEl ? nameEl.textContent.trim() : '';
        const category = catEl ? catEl.textContent.trim() : '';
    
        results.push({
          placeId: exPlaceId,
          name,
          category,
          rank: i + 1,  // 필터링된 요소의 인덱스 + 1을 사용
          isRestaurant: isRestaurant,
        });
      }
      return results;
    }, 300, isRestaurantVal === 1);

    // 2. 저장많은 순 페이지에서 "저장수" 정보 추출 (맛집인 경우)
    let savedCounts = {};
    if (isRestaurantVal === 1) {
      const savedUrl = `https://m.place.naver.com/${route}/list?query=${encodedKeyword}&x=${randX}&y=${randY}&order=false&rank=저장많은&keywordFilter=voting%5Efalse&level=top&entry=pll`;
      logger.info(' 저장수 정보 페이지 이동:', savedUrl);
      
      await page.goto(savedUrl, { waitUntil: 'domcontentloaded' });

      const savedListSelector = listItemSelector;
      logger.info(` 저장많은 순 셀렉터: ${savedListSelector}`);

      try {
        logger.info(' 저장수 지도(캔버스) 대기 중... (최대 15초)');
        await page.waitForSelector('canvas.mapboxgl-canvas', {
          timeout: 15000,
          visible: true
        });
        logger.info(' 저장수 지도(캔버스) 로딩 완료');
      } catch (err) {
        logger.warn('[WARN] 저장수 지도(캔버스) 로딩 실패, 크롤링은 계속 진행합니다.');
      }

      await randomDelay(1, 2);
      await performInfiniteScroll(page, savedListSelector);

      savedCounts = await page.evaluate((selector) => {
        const counts = {};
        const items = document.querySelectorAll(selector);
        
        for (const item of items) {
          const aTag = item.querySelector('a');
          if (!aTag) continue;
          
          const href = aTag.getAttribute('href') || '';
          const m = href.match(/\/(?:restaurant|place|cafe)\/(\d+)/);
          if (!m || !m[1]) continue;
          
          const placeId = m[1];
          
          const possibleSelectors = [
            '.h69bs',
            '.place_opt_wrap',
            '.place_section_content',
            '.place_bluelink + *',
            '[class*="save"]',
            '[class*="count"]',
          ];
          
          let found = false;
          for (const sel of possibleSelectors) {
            const elements = item.querySelectorAll(sel);
            for (const el of elements) {
              const text = el.textContent || '';
              if (/저장\s*수|찜|즐겨찾기|saved/i.test(text)) {
                const numMatch = text.match(/(\d[\d,]*)\s*(\+)?/);
                if (numMatch && numMatch[1]) {
                  counts[placeId] = parseInt(numMatch[1].replace(/,/g, ''), 10);
                  found = true;
                  break;
                }
              }
            }
            if (found) break;
          }
          
          if (!found) {
            // 전체 텍스트 파싱 or 휴리스틱
            const fullText = item.textContent || '';
            const savedPatterns = [
              /저장\s*수\s*(\d[\d,]*)\s*(\+)?/,
              /찜\s*(\d[\d,]*)\s*(\+)?/,
              /(\d[\d,]*)\s*명이\s*저장/,
              /(\d[\d,]*)\s*저장/,
              /저장\s*(\d[\d,]*)/
            ];
            for (const pattern of savedPatterns) {
              const match = fullText.match(pattern);
              if (match && match[1]) {
                counts[placeId] = parseInt(match[1].replace(/,/g, ''), 10);
                found = true;
                break;
              }
            }
            if (!found) {
              const numbers = fullText.match(/\d[\d,]+/g) || [];
              const hasSaveWord = /저장|찜|즐겨찾기/i.test(fullText);
              if (hasSaveWord && numbers.length > 0) {
                const maxNumber = Math.max(...numbers.map(n => parseInt(n.replace(/,/g, ''), 10)));
                counts[placeId] = maxNumber;
              }
            }
          }
        }
        return counts;
      }, savedListSelector);
      
      const countKeys = Object.keys(savedCounts).length;
      logger.info(` 저장수 정보: ${countKeys}개 항목`);
      const under1k = Object.values(savedCounts).filter(v => v < 1000).length;
      const over1k = Object.values(savedCounts).filter(v => v >= 1000).length;
      logger.info(` 저장수 ${under1k}개 항목이 1000 미만`);
      logger.info(` 저장수 ${over1k}개 항목이 1000 이상`);
    }

    //  (A) DB 저장: KeywordBasicCrawlResult -> "저장수" 제거
    const now = new Date();
    const today14h = new Date(now);
    today14h.setHours(14, 0, 0, 0);

    // Determine the start date based on the 14:00 rule
    const startDate = now < today14h ? 
      new Date(today14h.getTime() - 24 * 60 * 60 * 1000) : 
      today14h;

    logger.info(`14:00 rule applied: Start date = ${startDate.toISOString()}`);

    /**
     * 2) 수집된 items를 돌면서 KeywordBasicCrawlResult 항상 새로 생성
     */
    const failedItems = [];
    const stats = {
      total: items.length,
      success: 0,
      created: 0,
      updated: 0,
      failed: 0
    };

    logger.info(`[BasicCrawler] 키워드 "${keywordText}" - 총 ${items.length}개 항목 새로 저장 시작`);

    // 기존 레코드 삭제 로직 제거하고 항상 새로운 행으로 저장
    for (const item of items) {
      if (!item.placeId) continue;

      try {
        // 항상 새로운 행으로 생성
        await KeywordBasicCrawlResult.create({
          keyword_id: keywordId,
          place_id: parseInt(item.placeId, 10),
          place_name: item.name,
          category: item.category,
          ranking: item.rank,
          last_crawled_at: new Date()
        });
        stats.created++;
        stats.success++;
      } catch (err) {
        logger.error(`[ERROR] Failed to process item (placeId=${item.placeId}, name=${item.name}):`, err);
        failedItems.push(item);
        stats.failed++;
      }
    }

    // 통계 로깅 (삭제 관련 로그 제거)
    if (stats.created > 0) {
      logger.info(`[DB:CREATE] Created ${stats.created} new records for keyword "${keywordText}"`);
    }

    // 로그 출력 수정
    logger.info(`[BasicCrawler] Statistics for keyword "${keywordText}":`);
    logger.info(`- Total processed: ${stats.total}`);
    logger.info(`- Successfully created: ${stats.created}`);
    logger.info(`- Failed: ${stats.failed}`);
    logger.info(`- Completion rate: ${((stats.success) / stats.total * 100).toFixed(1)}%`);

    /** 
     * 5) items가 존재하면 basic_last_crawled_date 업데이트 
     */
    if (items && items.length > 0) {
      await updateKeywordBasicCrawled(keywordId);
      logger.info(`[BasicCrawler] 키워드 "${keywordText}" 기본 크롤링 완료, basic_last_crawled_date 업데이트됨.`);
    } else {
      logger.info(`[BasicCrawler] 키워드 "${keywordText}" 결과없음. basic_last_crawled_date 업데이트 안 함.`);
    }

    // (C) Now update place_detail_results with savedCount under the 14:00 rule
    logger.info(`[BasicCrawler] 키워드 "${keywordText}" - place_detail_results 테이블에 ${items.length}개 항목 초기화 시작`);

    try {
      const placeIds = items
        .map(item => parseInt(item.placeId, 10))
        .filter(id => !isNaN(id));

      // 1) "14:00" 기준 사이클 계산
      const now = new Date();
      const today14h = new Date(now);
      today14h.setHours(14, 0, 0, 0);

      let cycleStart; // 이번 사이클 시작 시각
      if (now >= today14h) {
        // 오늘 14시 지났으면 => 오늘 14시부터 내일 14시까지
        cycleStart = today14h;
      } else {
        // 오늘 14시가 안 지났으면 => 어제 14시부터 오늘 14시까지
        cycleStart = new Date(today14h.getTime() - 24 * 60 * 60 * 1000);
      }

      // 통계용 카운트
      let insertedCount = 0;
      let updatedCount = 0;
      let errorCount = 0;
      let detailQueueCount = 0;
      let skipDetailQueueCount = 0;

      // placeIds를 순회하면서 개별 트랜잭션 처리
      for (const pid of placeIds) {
        const item = items.find(it => parseInt(it.placeId, 10) === pid);
        if (!item) continue;

        // isRestaurantVal === 1인 경우에만 savedCount 추출
        const countVal = isRestaurantVal === 1
          ? (savedCounts[pid] ?? null)
          : null;

        // 트랜잭션을 사용해 중복 삽입 방지
        try {
          await sequelize.transaction(async (t) => {
            // 1) 이번 사이클 내에 이미 생성된 레코드가 있는지 확인
            const existing = await PlaceDetailResult.findOne({
              where: {
                place_id: pid,
                created_at: { [Op.gte]: cycleStart }
              },
              order: [['id', 'DESC']],
              transaction: t
            });

            if (existing) {
              // (a) 이번 사이클에 이미 있다면 -> update
              await existing.update({ savedCount: countVal }, { transaction: t });
              updatedCount++;
            } else {
              // (b) 이번 사이클 내 레코드가 없다면 -> 새로 생성
              await PlaceDetailResult.create({
                place_id: pid,
                last_crawled_at: null,
                savedCount: countVal
              }, { transaction: t });
              insertedCount++;
            }
            
            // 중요: detail 큐 추가 전 14:00 규칙에 따라 중복 체크
            let needsDetailCrawl = true;
            
            // 현재 사이클에 이미 완전히 크롤링된 데이터가 있는지 확인
            if (existing && 
                existing.blog_review_count !== null && 
                existing.receipt_review_count !== null && 
                existing.keywordList !== null) {
              // 이미 완전한 데이터가 있으면 큐에 추가하지 않음
              needsDetailCrawl = false;
              skipDetailQueueCount++;
            }
            
            // 필요한 경우에만 Detail 작업 큐 추가
            if (needsDetailCrawl) {
              await keywordQueue.add(
                'unifiedProcess',
                { type: 'detail', data: { placeId: pid } },
                { priority: 5 }
              );
              detailQueueCount++;
            }
          });
        } catch (err) {
          errorCount++;
          logger.error(`[ERROR] Failed to process place_id=${pid}: ${err.message}`);
          
          // 오류 발생 시에도 일단 큐에 추가 (데이터 처리 오류가 있어도 크롤링은 시도)
          await keywordQueue.add(
            'unifiedProcess',
            { type: 'detail', data: { placeId: pid } },
            { priority: 5 }
          );
          detailQueueCount++;
        }
      }

      logger.info(`[PLACE_DETAIL] 처리 완료 - 키워드 "${keywordText}": 총 ${placeIds.length}개 중 신규 ${insertedCount}개, 업데이트 ${updatedCount}개, 오류 ${errorCount}개`);
      logger.info(`[DETAIL_QUEUE] 총 ${detailQueueCount}개 장소가 detail 큐에 추가됨 (${skipDetailQueueCount}개 장소는 이미 크롤링 완료되어 스킵)`);
      
      if (errorCount > 0) {
        logger.warn(`[WARN] place_detail_results 처리 중 ${errorCount}개 항목에서 오류 발생`);
      }
    } catch (err) {
      logger.error(`[ERROR] place_detail_results 저장/업데이트 중 오류:`, err);
    }
    return items;
  } catch (err) {
    logger.error(`[ERROR][BasicCrawler] 키워드 "${keywordText}" 크롤링 실패:`, err);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      logger.info(' 브라우저 종료');
    }
  }
}

async function runCrawler() {
  try {
    // Get command line arguments
    const args = process.argv.slice(2);
    if (args.length < 1) {
      console.log('Usage: node basicCrawlerService.js <keyword> [keywordId]');
      console.log('Example 1: node basicCrawlerService.js "강남 맛집"');
      console.log('Example 2: node basicCrawlerService.js "강남 맛집" 123');
      process.exit(1);
    }

    const keyword = args[0];
    const keywordId = args[1] ? parseInt(args[1], 10) : null;
    
    console.log(`Starting crawler for keyword: "${keyword}"${keywordId ? ` (ID: ${keywordId})` : ''}`);
    
    // Run the crawler
    const results = await crawlKeywordBasic(keyword, keywordId);
    
    console.log(`Crawling completed for "${keyword}"`);
    console.log(`Found ${results.length} items`);
    
    // Exit successfully
    process.exit(0);
  } catch (error) {
    console.error('Crawling failed with error:', error);
    process.exit(1);
  }
}
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

// Auto-run if this file is executed directly (not imported)
if (isMainModule) {
  runCrawler();
}