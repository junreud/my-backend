// basicCrawler.js
import { checkIsRestaurantByDOM } from "../isRestaurantChecker.js";
import puppeteer from 'puppeteer';
import fetch from 'node-fetch'; // Added for saved counts
import {
  getRandomCoords,
  randomDelay,
  loadMobileUAandCookies,
  PROXY_SERVER
} from '../../config/crawler.js';
import KeywordBasicCrawlResult from '../../models/KeywordBasicCrawlResult.js';
import Keyword from '../../models/Keyword.js'; // Keyword 모델 추가
import { updateKeywordBasicCrawled } from './dbHelpers.js';
import { createLogger } from '../../lib/logger.js';
import PlaceDetailResult from '../../models/PlaceDetailResult.js';
import { Op } from 'sequelize';
const logger = createLogger('BasicCrawlerServiceLogger');


/**
 * 무한 스크롤 처리 함수
 */
async function performInfiniteScroll(page, itemSelector) {
  logger.info('[INFO] 무한 스크롤 시작');
  const scrollSel = '#_list_scroll_container';
  const MAX_ITEMS = 300;

  let previousCount = 0;
  let noChangeCount = 0;
  const MAX_NOCHANGE = 3; // 3번 연속 변화 없으면 중단
  let iteration = 0;
  const MAX_ITERATION = 20; // 20번까지 반복

  while (true) {
    iteration++;

    // 현재 아이템 수 (광고 제외)
    const currentCount = await page.$$eval(itemSelector, els => {
      // 광고가 아닌 항목만 카운트
      return els.filter(el => {
        const laimExpId = el.getAttribute('data-laim-exp-id');
        return laimExpId !== 'undefined*e'; // 광고 아닌 것만 포함
      }).length;
    });
    
    logger.debug(`[DEBUG] 현재 아이템 개수: ${currentCount}개 (광고 제외)`);
    
    // 추가 조건: 100개 이상이고 정확히 100의 배수인 경우에만 유효한 종료 포인트로 인정
    if (currentCount >= 100 && (currentCount % 100 === 0)) {
      logger.debug(`[DEBUG] 광고 제외 아이템 개수 ${currentCount}, 정확히 100의 배수 → 스크롤 중단 가능`);
      // 여기서는 즉시 중단하지 않고, 추가 스크롤 없이 1회 더 체크 후 결정
      if (noChangeCount > 0) {
        logger.debug(`[DEBUG] 100의 배수(${currentCount})에서 더 이상 증가 없음 → 중단`);
        break;
      }
    }
    
    // 100의 배수가 아닌 경우에는 계속 스크롤
    if (currentCount >= 100 && (currentCount % 100 !== 0)) {
      logger.debug(`[DEBUG] 광고 제외 아이템 개수 ${currentCount}, 100의 배수가 아님 → 계속 스크롤`);
    }
    
    if (currentCount >= MAX_ITEMS) {
      logger.debug(`[DEBUG] 아이템 개수 ${currentCount}, 최대 도달 → 중단`);
      break;
    }

    // 스크롤 내리기
    await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      if (container) {
        container.scrollTo(0, container.scrollHeight);
      }
    }, scrollSel);

    // waitForFunction으로 새 아이템 로딩 대기
    try {
      await page.waitForFunction(
        (sel, count) => {
          const elements = document.querySelectorAll(sel);
          const nonAdElements = Array.from(elements).filter(el => {
            const laimExpId = el.getAttribute('data-laim-exp-id');
            return laimExpId !== 'undefined*e'; // 광고 아닌 것만 포함
          });
          return nonAdElements.length > count; // 광고 제외한 항목 수 기준
        },
        {
          timeout: 7000,
        },
        itemSelector,
        currentCount // 두 번째 인수로 전달
      );
    } catch (err) {
      logger.debug('[DEBUG] 더 이상 증가 안 하거나, 타임아웃 → 체크 진행');
    }

    // 다시 아이템 개수 확인 (광고 제외)
    const newCount = await page.$$eval(itemSelector, els => {
      return els.filter(el => {
        const laimExpId = el.getAttribute('data-laim-exp-id');
        return laimExpId !== 'undefined*e'; // 광고 아닌 것만 포함
      }).length;
    });
    
    if (newCount > previousCount) {
      logger.debug(`[DEBUG] 아이템 개수 증가: ${previousCount} -> ${newCount} (광고 제외)`);
      previousCount = newCount;
      noChangeCount = 0;
    } else {
      noChangeCount++;
      logger.debug(`[DEBUG] 아이템 개수 변동 없음: ${newCount}, noChangeCount=${noChangeCount} (광고 제외)`);
    }

    if (iteration >= MAX_ITERATION || noChangeCount >= MAX_NOCHANGE) {
      logger.debug(`[DEBUG] 무한 스크롤 중단: iteration=${iteration}, noChangeCount=${noChangeCount}`);
      break;
    }
  }
  
  // 마지막으로 총 아이템 수와 광고 제외 아이템 수 모두 리포트
  const totalItems = await page.$$eval(itemSelector, els => els.length);
  const validItems = await page.$$eval(itemSelector, els => {
    return els.filter(el => {
      const laimExpId = el.getAttribute('data-laim-exp-id');
      return laimExpId !== 'undefined*e';
    }).length;
  });
  
  logger.info(`[INFO] 무한 스크롤 종료: 총 ${totalItems}개 항목 중 ${validItems}개가 유효한 항목 (광고 ${totalItems - validItems}개 제외)`);
  return validItems; // 광고를 제외한 유효 항목 수 반환
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
export async function crawlKeywordBasic(keyword, keywordId, baseX = 126.9783882, baseY = 37.5666103, crawlJobId) {
  let browser;
  let page;

  try {
    logger.info(`[INFO][BasicCrawler] 키워드 "${keyword}" 기본 크롤링 시작`);

    // 1) 키워드 정보 확인
    let keywordObj;
    if (keywordId) {
      keywordObj = await Keyword.findByPk(keywordId);
      if (!keywordObj) {
        logger.error(`[ERROR] 키워드 ID ${keywordId}를 찾을 수 없습니다.`);
        throw new Error(`키워드 ID ${keywordId}를 찾을 수 없습니다.`);
      }
      
      // 오늘 날짜 14시 기준 확인
      const now = new Date();
      const today14h = new Date(now);
      today14h.setHours(14, 0, 0, 0); // 오늘 14:00
      
      // 이미 오늘 14시 이후에 크롤링된 경우 건너뜀
      if (keywordObj.basic_last_crawled_date) {
        const lastCrawled = new Date(keywordObj.basic_last_crawled_date);
        if (lastCrawled >= today14h && now >= today14h) {
          logger.info(`[INFO] 키워드 "${keyword}" (ID: ${keywordId})는 이미 오늘 14시 이후에 크롤링되었습니다. basicCrawl을 건너뜁니다.`);
          return [];
        }
      }
      
    } else {
      // 키워드 이름으로 검색
      keywordObj = await Keyword.findOne({
        where: { keyword: keyword }
      });
      
      // 존재하지 않으면 새로 생성
      if (!keywordObj) {
        const isRestaurantVal = await checkIsRestaurantByDOM(keyword);
        keywordObj = await Keyword.create({
          keyword: keyword,
          isRestaurant: isRestaurantVal === 1 ? true : false
        });
        logger.info(`[INFO] 새 키워드 "${keyword}" 생성됨, ID: ${keywordObj.id}`);
      } else {
        // 오늘 날짜 14시 기준 확인
        const now = new Date();
        const today14h = new Date(now);
        today14h.setHours(14, 0, 0, 0); // 오늘 14:00
        
        // 이미 오늘 14시 이후에 크롤링된 경우 건너뜀
        if (keywordObj.basic_last_crawled_date) {
          const lastCrawled = new Date(keywordObj.basic_last_crawled_date);
          if (lastCrawled >= today14h && now >= today14h) {
            logger.info(`[INFO] 키워드 "${keyword}"는 이미 오늘 14시 이후에 크롤링되었습니다. 처리를 건너뜁니다.`);
            return [];
          }
        }
        
      }
      
      keywordId = keywordObj.id;
    }

    // 기존의 맛집 키워드 여부 확인 로직 사용
    const isRestaurantVal = keywordObj.isRestaurant ? 1 : 0;
    logger.debug(`[DEBUG] isRestaurantVal=${isRestaurantVal}`);

    // Puppeteer 옵션
    const launchOptions = {
      headless: 'new',
      args: []
    };
    if (PROXY_SERVER) {
      launchOptions.args.push(`--proxy-server=${PROXY_SERVER}`);
      logger.info('[INFO] 프록시 사용:', PROXY_SERVER);
    }
    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();

    // 무작위 좌표
    const { randX, randY } = getRandomCoords(baseX, baseY, 300);
    logger.debug(`[DEBUG] 무작위 좌표: (x=${randX.toFixed(7)}, y=${randY.toFixed(7)})`);

    // 2) 검색 URL - 맛집 여부에 따라 경로 조정
    const encodedKeyword = encodeURIComponent(keyword);
    const route = isRestaurantVal === 1 ? 'restaurant' : 'place';

    // URL 구성 시 rank=저장많은 파라미터를 기본으로 포함
    let placeUrl = `https://m.place.naver.com/${route}/list?query=${encodedKeyword}&x=${randX}&y=${randY}&level=top&entry=pll`;
    logger.debug(`[DEBUG] 기본 정보 URL: ${placeUrl}`);
  
    // 쿠키와 UA 설정
    const { ua, cookieStr } = loadMobileUAandCookies();
    await page.setUserAgent(ua);

    // 쿠키 설정
    const cookieArr = cookieStr.split('; ').map(pair => {
      const [name, value] = pair.split('=');
      return { name, value, domain: '.naver.com', path: '/' };
    });
    await page.setCookie(...cookieArr);

    // 페이지 이동
    logger.info('[INFO] 페이지 이동:', placeUrl);
    await page.goto(placeUrl, { waitUntil: 'domcontentloaded' });

    // 목록 로딩 대기 - restaurant와 place에 따라 다른 셀렉터 사용
    logger.info(`[INFO] ${isRestaurantVal === 1 ? '레스토랑' : '일반 장소'} 모드로 목록 셀렉터 확인`);

    // restaurant와 place에 따라 다른 셀렉터 직접 지정
    let listItemSelector;
    if (isRestaurantVal === 1) {
      // 레스토랑인 경우
      listItemSelector = 'li.UEzoS';
    } else {
      // 일반 장소인 경우
      listItemSelector = 'li.VLTHu';
    }

    logger.info(`[INFO] 선택된 목록 셀렉터: ${listItemSelector}`);

    // 셀렉터가 존재하는지 확인
    try {
      // 먼저 셀렉터 대기
      logger.info(`[INFO] ${listItemSelector} 셀렉터 대기 중... (최대 10초)`);
      await page.waitForSelector(listItemSelector, { timeout: 10000 });
      logger.info('[INFO] 목록 페이지 로딩 완료');
      
      // 셀렉터 존재 확인 (여기서는 항상 true여야 함)
      const count = await page.$$eval(listItemSelector, els => els.length);
      logger.info(`[INFO] ${listItemSelector} 셀렉터로 ${count}개 항목 발견됨`);
    } catch (err) {
      logger.error(`[ERROR] 셀렉터 ${listItemSelector} 대기 중 오류 발생:`, err);
      throw new Error(`셀렉터 ${listItemSelector}를 찾을 수 없습니다. 페이지 구조가 변경되었을 수 있습니다.`);
    }
    // 초기 진입 후 대기
    await randomDelay(1, 2);

    // 무한 스크롤 실행 - 발견된 셀렉터 전달
    await performInfiniteScroll(page, listItemSelector);

    // 아이템 추출 시 발견된 셀렉터 사용
    const items = await page.$$eval(listItemSelector, (els, maxCount, isRestaurant) => {
      const results = [];
      for (let i = 0; i < els.length && results.length < maxCount; i++) {
        const el = els[i];
        // 광고 제외
        const laimExpId = el.getAttribute('data-laim-exp-id');
        if (laimExpId === 'undefined*e') continue;
    
        const aTag = el.querySelector('a');
        if (!aTag) continue;
    
        const href = aTag.getAttribute('href') || '';
        let exPlaceId = '';
        
        // 음식점/일반 장소 모두 고려한 정규식
        const m = href.match(/\/(?:restaurant|place|cafe)\/(\d+)/);
        if (m && m[1]) {
          exPlaceId = m[1];
        }
    
        // 일반 장소와 음식점 셀렉터 구분
        let nameEl, catEl;
        
        if (isRestaurant) {
          // 레스토랑 셀렉터
          nameEl = el.querySelector('span.TYaxT');
          catEl = el.querySelector('.KCMnt');
        } else {
          // 일반 장소인 경우
          nameEl = el.querySelector('span.place_bluelink, span.TYaxT, span._3Apve');
          catEl = el.querySelector('.KCMnt, .OXiLu, ._3hCbH');
        }
        
        const name = nameEl ? nameEl.textContent.trim() : '';
        const category = catEl ? catEl.textContent.trim() : '';
    
        results.push({
          placeId: exPlaceId,
          name,
          category,
          rank: results.length + 1,
          isRestaurant: isRestaurant,
        });
      }
      return results;
    }, 300, isRestaurantVal === 1);


    // 2. 저장많은 순 페이지에서 저장수 정보 추출 (맛집인 경우에만)
    let savedCounts = {};
    if (isRestaurantVal === 1) {
      // 저장많은 순 URL
      const savedUrl = `https://m.place.naver.com/${route}/list?query=${encodedKeyword}&x=${randX}&y=${randY}&order=false&rank=저장많은&keywordFilter=voting%5Efalse&level=top&entry=pll`;
      logger.info('[INFO] 저장수 정보 페이지 이동:', savedUrl);
      
      // 새 페이지로 이동
      await page.goto(savedUrl, { waitUntil: 'domcontentloaded' });
      
      // 레스토랑은 항상 li.UEzoS 셀렉터 사용 (일반 장소인 경우 실행되지 않음)
      const savedListSelector = 'li.UEzoS';
      logger.info(`[INFO] 저장순 페이지 목록 셀렉터: ${savedListSelector}`);
      
      // 목록 로딩 대기
      await page.waitForSelector(savedListSelector, { timeout: 10000 });
      await randomDelay(1, 2);
      // 무한 스크롤 실행 - 저장순 페이지에서
      await performInfiniteScroll(page, savedListSelector);

      // 저장수 정보 추출
      savedCounts = await page.evaluate((selector) => {
        const counts = {};
        const items = document.querySelectorAll(selector);
        console.log(`[DEBUG] 찾은 항목 수: ${items.length}`);
        
        for (const item of items) {
          const aTag = item.querySelector('a');
          if (!aTag) continue;
          
          const href = aTag.getAttribute('href') || '';
          const m = href.match(/\/(?:restaurant|place|cafe)\/(\d+)/);
          if (!m || !m[1]) continue;
          
          const placeId = m[1];
          
          // 더 많은 잠재적 저장수 표시 요소 선택자들
          const possibleSelectors = [
            '.h69bs',           // 기존 선택자
            '.place_opt_wrap',  // 추가 선택자
            '.place_section_content', // 다른 가능한 영역
            '.place_bluelink + *', // 장소명 다음 요소
            '[class*="save"]',  // save 관련 클래스를 가진 요소
            '[class*="count"]', // count 관련 클래스를 가진 요소
          ];
          
          let found = false;
          
          // 1. 각 선택자별로 저장수 추출 시도
          for (const selector of possibleSelectors) {
            const elements = item.querySelectorAll(selector);
            
            for (const el of elements) {
              const text = el.textContent || '';
              // 더 넓은 범위의 패턴 매칭 (저장수/찜/저장/즐겨찾기 등)
              if (/저장\s*수|찜|즐겨찾기|saved/i.test(text)) {
                console.log(`[DEBUG] placeId: ${placeId}, 저장수 관련 텍스트 발견: "${text}" (선택자: ${selector})`);
                
                // 숫자 부분만 추출 (더 유연한 정규식)
                const numMatch = text.match(/(\d[\d,]*)\s*(\+)?/);
                
                if (numMatch && numMatch[1]) {
                  counts[placeId] = parseInt(numMatch[1].replace(/,/g, ''), 10);
                  found = true;
                  console.log(`[DEBUG] placeId: ${placeId}, 추출된 저장수: ${counts[placeId]}`);
                  break;
                }
              }
            }
            
            if (found) break;
          }
          
          // 2. 전체 항목 텍스트에서 직접 저장수 찾기 (1이 실패한 경우)
          if (!found) {
            const fullText = item.textContent || '';
            
            // 저장수 패턴 강화
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
                console.log(`[DEBUG] placeId: ${placeId}, 전체 텍스트에서 패턴 ${pattern}으로 추출된 저장수: ${counts[placeId]}`);
                found = true;
                break;
              }
            }
            
            // 3. 마지막 수단: 숫자 + "저장" 관련 단어가 가까이 있는지 확인
            if (!found) {
              // 모든 숫자 추출
              const numbers = fullText.match(/\d[\d,]+/g) || [];
              // 저장 관련 단어가 있는지 확인
              const hasSaveWord = /저장|찜|즐겨찾기/i.test(fullText);
              
              if (hasSaveWord && numbers.length > 0) {
                // 가장 큰 숫자를 저장수로 가정
                const maxNumber = Math.max(...numbers.map(n => parseInt(n.replace(/,/g, ''), 10)));
                counts[placeId] = maxNumber;
                console.log(`[DEBUG] placeId: ${placeId}, 최종 휴리스틱으로 추출된 저장수: ${counts[placeId]}`);
              } else {
                console.log(`[DEBUG] placeId: ${placeId}, 저장수를 찾지 못함`);
              }
            }
          }
        }
        
        return counts;
      }, savedListSelector);
      
      logger.info(`[INFO] 저장수 정보: ${Object.keys(savedCounts).length}개 항목`);
      logger.info(`[INFO] 저장수 ${Object.values(savedCounts).filter(v => v < 1000).length}개 항목이 1000 미만`);
      logger.info(`[INFO] 저장수 ${Object.values(savedCounts).filter(v => v >= 1000).length}개 항목이 1000 이상`);
    }

    // DB 저장 로직에 재시도 매커니즘 추가
    const failedItems = [];
    const stats = {
      total: items.length,
      success: 0,
      failed: 0,
      retried: 0,
      finalFailed: 0
    };

    for (const item of items) {
      if (!item.placeId) continue;
      
      try {
        // 해당 placeId의 저장수 가져오기
        const savedCount = savedCounts[item.placeId] || null;
        
        await KeywordBasicCrawlResult.create({
          keyword_id: keywordId,
          place_id: parseInt(item.placeId, 10),
          place_name: item.name,
          category: item.category,
          ranking: item.rank,
          savedCount: savedCount,
          crawl_job_id: crawlJobId
        });
        
        logger.info(`[DB:INSERT] 항목 저장 성공: place_id=${item.placeId}, place_name=${item.name}, rank=${item.rank}, savedCount=${savedCount}`);
        stats.success++;
      } catch (err) {
        logger.error(`[ERROR] 항목 저장 실패 (placeId=${item.placeId}):`, err);
        failedItems.push({
          item,
          savedCount: savedCounts[item.placeId] || null
        });
        stats.failed++;
      }
    }

    // 실패한 항목이 있으면 1회만 재시도
    if (failedItems.length > 0) {
      logger.info(`[INFO] 키워드 "${keyword}" - 저장 실패: ${failedItems.length}개 항목 재시도`);
      
      for (const failedItem of failedItems) {
        try {
          await randomDelay(1, 2);
          const { item, savedCount } = failedItem;
          
          await KeywordBasicCrawlResult.create({
            keyword_id: keywordId,
            place_id: parseInt(item.placeId, 10),
            place_name: item.name,
            category: item.category,
            ranking: item.rank,
            savedCount: savedCount,
            crawl_job_id: crawlJobId
          });
          
          logger.info(`[DB:INSERT] 재시도 성공: place_id=${item.placeId}, place_name=${item.name}`);
          stats.retried++;
        } catch (err) {
          logger.error(`[ERROR] 최종 저장 실패 (placeId=${failedItem.item.placeId}):`, err);
          stats.finalFailed++;
        }
      }
    }

    // 성공/실패 통계 출력
    logger.info(`[INFO][BasicCrawler] 키워드 "${keyword}" 저장 통계:`);
    logger.info(`- 총 처리: ${stats.total}개`);
    logger.info(`- 성공: ${stats.success}개 (첫 시도)`);
    logger.info(`- 재시도 성공: ${stats.retried}개`);
    logger.info(`- 최종 실패: ${stats.finalFailed}개`);
    logger.info(`- 완료율: ${((stats.success + stats.retried) / stats.total * 100).toFixed(1)}%`);

    // 기본 크롤링 완료 플래그 설정
    await updateKeywordBasicCrawled(keywordId);
    logger.info(`[INFO][BasicCrawler] 키워드 "${keyword}" 기본 크롤링 완료, basic_last_crawled_date가 업데이트되었습니다.`);

    // 상세 크롤링을 위한 place_detail_results 테이블에 place_id 초기화
    logger.info(`[INFO][BasicCrawler] 키워드 "${keyword}" - place_detail_results 테이블에 ${items.length}개 항목 초기화 시작`);

    // 14시 기준 크롤링 판단 로직
    const now = new Date();
    const today14h = new Date(now);
    today14h.setHours(14, 0, 0, 0); // 오늘 14:00

    // 어제 14시 계산
    const yesterday14h = new Date(today14h);
    yesterday14h.setDate(yesterday14h.getDate() - 1);

    // 크롤링해야 하는 시간 기준 계산
    const shouldCrawlAfter = now >= today14h ? today14h : yesterday14h;
    logger.info(`[INFO] 현재 시간: ${now.toISOString()}, 크롤링 기준 시간: ${shouldCrawlAfter.toISOString()}`);

    // 이미 존재하는 place_id 확인
    try {
      const placeIds = items.map(item => parseInt(item.placeId, 10)).filter(id => !isNaN(id));
      
      // 기존 레코드 조회
      const existingRecords = await PlaceDetailResult.findAll({
        attributes: ['place_id', 'last_crawled_at'],
        where: {
          place_id: { [Op.in]: placeIds }
        },
        raw: true
      });
      
      // 기존 레코드의 place_id를 Set으로 변환
      const existingPlaceIdSet = new Set(existingRecords.map(r => r.place_id));
      
      // 재크롤링 필요한 기존 항목 (last_crawled_at이 기준시간 이전)
      const needsRecrawlIds = existingRecords
        .filter(r => !r.last_crawled_at || new Date(r.last_crawled_at) < shouldCrawlAfter)
        .map(r => r.place_id);
      
      // 신규 항목 (place_detail_results에 없는 place_id)
      const newPlaceIds = placeIds.filter(id => !existingPlaceIdSet.has(id));
      
      logger.info(`[INFO] 재크롤링 필요: ${needsRecrawlIds.length}개, 신규 항목: ${newPlaceIds.length}개`);
      
      // 업데이트 배치 (재크롤링 필요 항목)
      if (needsRecrawlIds.length > 0) {
        await PlaceDetailResult.update(
          { last_crawled_at: null }, // null로 설정하여 자동 크롤링 대상으로 표시
          { where: { place_id: { [Op.in]: needsRecrawlIds } } }
        );
        logger.info(`[INFO] ${needsRecrawlIds.length}개 항목이 재크롤링 대상으로 표시되었습니다.`);
      }
      
      // 신규 삽입 배치
      if (newPlaceIds.length > 0) {
        const newPlaceBatch = newPlaceIds.map(placeId => {
          // 이름 찾기
          const item = items.find(item => parseInt(item.placeId, 10) === placeId);
          return {
            place_id: placeId,
            place_name: item?.name || '',
            blog_review_count: 0,
            receipt_review_count: 0,
            last_crawled_at: null, // null로 설정하여 자동 크롤링 대상으로 표시
            crawl_job_id: crawlJobId
          };
        });
        
        await PlaceDetailResult.bulkCreate(newPlaceBatch);
        logger.info(`[INFO] ${newPlaceIds.length}개의 신규 장소가 상세 크롤링 대상으로 등록되었습니다.`);
      }
      
      logger.info(`[INFO] 키워드 "${keyword}" - place_detail_results 테이블 초기화 완료`);
    } catch (err) {
      logger.error(`[ERROR] place_detail_results 테이블 초기화 중 오류:`, err);
    }

    return items;
  } catch (err) {
    logger.error(`[ERROR][BasicCrawler] 키워드 "${keyword}" 크롤링 실패:`, err);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      logger.info('[INFO] 브라우저 종료');
    }
  }
}

/**
 * 모든 basic_crawled=false 키워드에 대해 기본 크롤링 실행
 */
export async function crawlAllPendingBasics() {
  // 수정: basic_last_crawled_date가 없는 키워드 찾기
  const pendingKeywords = await Keyword.findAll({
    where: {
      basic_last_crawled_date: null
    }
  });
  
  if (pendingKeywords.length === 0) {
    logger.info('[INFO] 기본 크롤링이 필요한 키워드가 없습니다.');
    return;
  }
  
  logger.info(`[INFO] 기본 크롤링이 필요한 키워드가 ${pendingKeywords.length}개 있습니다.`);
  
  // 각 키워드에 대해 순차적으로 기본 크롤링 실행
  for (const keyword of pendingKeywords) {
    logger.info(`[INFO] 키워드 "${keyword.keyword}" (ID: ${keyword.id})에 대한 기본 크롤링 시작...`);
    await crawlKeywordBasic(keyword.keyword, keyword.id);
    
    // 각 키워드 사이에 딜레이 추가
    await randomDelay(2, 5);
  }
  
  logger.info('[INFO] 모든 대기 중인 키워드의 기본 크롤링이 완료되었습니다.');
}

/**
 * 모든 키워드에 대해 기본 크롤링 실행 (작업 날짜 기준)
 */
export async function crawlAllKeywordsBasic(jobDate = new Date(), crawlJobId) {
  const allKeywords = await Keyword.findAll();
  
  if (allKeywords.length === 0) {
    logger.info('[INFO] 크롤링할 키워드가 없습니다.');
    return;
  }
  
  logger.info(`[INFO] 총 ${allKeywords.length}개 키워드에 대한 기본 크롤링을 시작합니다.`);
  
  for (const keyword of allKeywords) {
    try {
      logger.info(`[INFO] 키워드 "${keyword.keyword}" (ID: ${keyword.id})에 대한 기본 크롤링 시작...`);
      
      await KeywordBasicCrawlResult.destroy({
        where: {
          keyword_id: keyword.id,
          created_at: {
            [Op.gte]: new Date(jobDate.setHours(0, 0, 0, 0)),
            [Op.lt]: new Date(jobDate.setHours(23, 59, 59, 999))
          }
        }
      });
      
      await crawlKeywordBasic(keyword.keyword, keyword.id, 126.9783882, 37.5666103, crawlJobId);
      
      await randomDelay(2, 5);
    } catch (error) {
      logger.error(`[ERROR] 키워드 "${keyword.keyword}" (ID: ${keyword.id}) 기본 크롤링 중 오류: ${error.message}`);
      continue;
    }
  }
  
  logger.info('[INFO] 모든 키워드의 기본 크롤링이 완료되었습니다.');
}

// 이 파일이 직접 실행되었는지 확인 node services/crawler/basicCrawlerService.js  
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  (async () => {
    try {
      const args = process.argv.slice(2);
      const command = args[0]; // 첫 번째 인자: 명령어
      const directKeywordId = 296;
      logger.info(`[INFO] ID ${directKeywordId} 직접 호출`);
      const directKeywordObj = await Keyword.findByPk(directKeywordId);
      if (directKeywordObj) {
        logger.info(`[INFO] 키워드 "${directKeywordObj.keyword}" (ID: ${directKeywordId}) 직접 크롤링 시작`);
        await crawlKeywordBasic(directKeywordObj.keyword, directKeywordId);
      }
      logger.info('[INFO] 작업이 완료되었습니다.');
      process.exit(0);
    } catch (err) {
      logger.error('[ERROR] 실행 중 오류 발생:', err);
      process.exit(1);
    }
  })();
}