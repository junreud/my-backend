// basicCrawler.js
import { checkIsRestaurantByDOM } from "../isRestaurantChecker.js";
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
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
import { getSearchVolumes } from '../naverAdApiService.js';

const logger = createLogger('BasicCrawlerServiceLogger', { service: 'crawler' });

//TODO : 로그 수정 전체적으로 하기, 원인불명의 기본크롤링 진행하는 경우가 있음 로그보면서 파악해보자.


/**
 * 키워드의 basic_last_crawled_date 갱신 (성공시만 동작하게 임의 설정해야함)
 */
export async function updateKeywordBasicCrawled(keywordId) {
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
 * @param {*} forceRecrawl 
 * @returns 
 *  - items: 크롤링 결과 항목 배열
 *  - KeywordCrawlResult 테이블에 결과 저장
 *  - Keyword 테이블에 새 키워드 생성
 *  - isRestaurant 값은 isRestaurantChecker.js로부터 가져옴
 */
export async function crawlKeywordBasic(keyword, keywordId, baseX = 126.9783882, baseY = 37.5666103, forceRecrawl = false) {
  const __filename = fileURLToPath(import.meta.url);
  logger.info(`[INFO] 키워드 '${keyword}'(ID:${keywordId}) 기본 크롤링 시작. 좌표: (${baseX}, ${baseY}), 강제 재크롤링: ${forceRecrawl}`);

  // 14:00 기준 사이클 계산 (PlaceDetailResult 생성 시 사용)
  const now = new Date();
  const today14h = new Date(now);
  today14h.setHours(14, 0, 0, 0);
  const cycleStart = now >= today14h ? today14h : new Date(today14h.getTime() - 24 * 60 * 60 * 1000);

  let browser;
  let context;
  let page;
  let success = false;
  let crawledItemsCount = 0;
  let errorDetails = null;

  try {
    const { ua, cookieStr } = loadMobileUAandCookies();
    const cookies = cookieStr.split('; ').map(pair => {
      const parts = pair.split('=');
      return { name: parts[0], value: parts[1], domain: '.naver.com', path: '/' };
    });

    const proxyArgs = PROXY_SERVER ? [`--proxy-server=${PROXY_SERVER}`] : [];
    browser = await chromium.launch({
      headless: true, // 실제 운영 시 true
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        // '--single-process', // 일부 환경에서 문제 발생 가능
        '--disable-gpu',
        ...proxyArgs
      ]
    });

    context = await browser.newContext({
      userAgent: ua,
      geolocation: { longitude: parseFloat(baseX), latitude: parseFloat(baseY) },
      bypassCSP: true,
      extraHTTPHeaders: {
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    await context.addCookies(cookies);
    page = await context.newPage();

    const url = `https://m.place.naver.com/restaurant/list?query=${encodeURIComponent(keyword)}&x=${baseX}&y=${baseY}&level=top&entry=pll`;
    logger.info(`[INFO] URL로 이동 중: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    await randomDelay(2, 3);

    // 무한 스크롤
    const itemSelector = 'li[data-laim-exp-id]'; // 광고 포함 모든 아이템
    await performInfiniteScroll(page, itemSelector, 300); // 최대 300개 (광고 제외)

    const items = await page.evaluate(({ selector }) => {
      const elements = Array.from(document.querySelectorAll(selector));
      return elements
        .filter(el => {
          const laimExpId = el.getAttribute('data-laim-exp-id');
          return laimExpId !== 'undefined*e'; // 광고 제외
        })
        .map((el, index) => {
          // place_id 추출 - 새로운 DOM 구조에 맞게 수정
          let placeId = null;
          
          // 메인 링크에서 place_id 추출 시도
          const mainLink = el.querySelector('a.place_bluelink[href*="/restaurant/"]') || 
                           el.querySelector('a[href*="/restaurant/"]');
          if (mainLink && mainLink.href) {
            const match = mainLink.href.match(/\/restaurant\/(\d+)/);
            if (match) {
              placeId = match[1];
            }
          }
          
          // data-id에서도 시도 (혹시 있을 경우)
          if (!placeId) {
            placeId = el.getAttribute('data-id');
          }
          
          // 업체명 추출 - 새로운 셀렉터
          const name = el.querySelector('span.TYaxT')?.innerText.trim() ||
                      el.querySelector('.place_bluelink > span.place_bluelink_text')?.innerText.trim() || 
                      el.querySelector('span.YwYLL')?.innerText.trim() ||
                      el.querySelector('[class*="place_bluelink"]')?.innerText.trim() ||
                      el.querySelector('a[href*="/place/"] span')?.innerText.trim() ||
                      el.querySelector('a[href*="/restaurant/"] span')?.innerText.trim();
          
          // 카테고리 추출 - 새로운 셀렉터  
          const category = el.querySelector('span.KCMnt')?.innerText.trim() ||
                          el.querySelector('[class*="KCMnt"]')?.innerText.trim() ||
                          el.querySelector('.category')?.innerText.trim();
          
          // 리뷰 수 추출 - 업데이트된 셀렉터로 시도
          const reviewElement = el.querySelector('span.h69bs.a2RFq') ||
                               el.querySelector('[class*="h69bs"]') ||
                               el.querySelector('[class*="review"]');
          let reviewCount = 0;
          if (reviewElement) {
            const reviewText = reviewElement.innerText.match(/[\d,]+/);
            if (reviewText) {
              reviewCount = parseInt(reviewText[0].replace(/,/g, ''), 10);
            }
          }
          
          // 링크 추출 - 메인 링크 사용
          const link = mainLink?.href ||
                      el.querySelector('a[href*="/place/"]')?.href ||
                      el.querySelector('a[href*="/restaurant/"]')?.href;
          
          // 주소 추출 - 업데이트된 셀렉터로 시도
          const address = el.querySelector('.qHRwL')?.innerText.trim() ||
                         el.querySelector('[class*="qHRwL"]')?.innerText.trim() ||
                         el.querySelector('.address')?.innerText.trim() ||
                         el.querySelector('[class*="address"]')?.innerText.trim();

          // 저장수 추출 - 업데이트된 셀렉터로 시도
          let savedCount = 0;
          const saveButton = el.querySelector('button[aria-label*="저장"] span.place_save_count') ||
                            el.querySelector('button[aria-label*="저장"]') ||
                            el.querySelector('[class*="save"]') ||
                            el.querySelector('[class*="Save"]');
          if (saveButton) {
            const saveText = saveButton.innerText || saveButton.textContent;
            if (saveText) {
              const savedMatch = saveText.match(/[\d,]+/);
              if (savedMatch) {
                savedCount = parseInt(savedMatch[0].replace(/,/g, ''), 10);
              }
            }
          }

          return {
            rank: index + 1,
            placeId,
            name,
            category,
            reviewCount,
            link,
            address,
            savedCount,
            // isRestaurant는 여기서 판단하지 않고, PlaceDetailResult 생성/업데이트 시 checkIsRestaurantByDOM 호출
            // created_at은 PlaceDetailResult 생성 시 cycleStart 기준으로 설정
          };
        });
    }, { selector: itemSelector });

    crawledItemsCount = items.length;
    logger.info(`[INFO] 키워드 '${keyword}' (ID:${keywordId}) 기본 크롤링 완료. ${crawledItemsCount}개 항목 수집.`);

    if (crawledItemsCount > 0) {
      const transaction = await sequelize.transaction();
      try {
        // 각 검색 결과별로 개별 KeywordBasicCrawlResult 레코드 생성
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          
          // place_id가 null이거나 빈 문자열인 경우 건너뛰기
          if (!item.placeId || item.placeId.trim() === '') {
            logger.warn(`[WARN] place_id가 없는 항목 건너뛰기: rank=${item.rank}, name=${item.name}`);
            continue;
          }
          
          await KeywordBasicCrawlResult.create({
            keyword_id: keywordId,
            ranking: item.rank,
            place_id: item.placeId,
            place_name: item.name,
            category: item.category,
            last_crawled_at: new Date()
          }, { transaction });
        }

        logger.info(`[INFO] KeywordBasicCrawlResult 저장 완료 (${items.length}개 레코드)`);

        // PlaceDetailResult 생성 또는 업데이트 및 detail-crawl 작업 추가
        let newPlacesCount = 0;
        let updatedPlacesCount = 0;
        let detailCrawlJobsCount = 0;
        
        for (const item of items) {
          if (!item.placeId) {
            logger.warn(`[WARN] PlaceId가 없는 항목 발견: ${item.name}, 건너뛰기.`);
            continue;
          }

          const [placeDetailRecord, created] = await PlaceDetailResult.findOrCreate({
            where: {
              place_id: item.placeId,
              created_at: { [Op.gte]: cycleStart } // 오늘자 레코드
            },
            defaults: {
              place_id: item.placeId,
              savedCount: item.savedCount, // 기본 크롤링에서 수집한 저장수
              // blog_review_count, receipt_review_count, keywordList 등은 detail 크롤링 담당
              created_at: cycleStart // 정확한 사이클 시작 시간으로 설정
            },
            transaction
          });

          if (created) {
            newPlacesCount++;
          } else {
            // 이미 존재하면 savedCount 등 기본 정보 업데이트 (필요 시)
            if (placeDetailRecord.savedCount !== item.savedCount) {
              await placeDetailRecord.update({
                savedCount: item.savedCount
              }, { transaction });
              updatedPlacesCount++;
            }
          }
          
          // Add detail crawl job to the queue
          await keywordQueue.add('detail-crawl', { placeId: item.placeId });
          detailCrawlJobsCount++;
        }

        // 요약 로그 출력
        logger.info(`[INFO] '${keyword}' 키워드 크롤링 완료: 신규 업체 ${newPlacesCount}개, 업데이트 ${updatedPlacesCount}개, 상세 크롤링 작업 ${detailCrawlJobsCount}개 추가`);

        await transaction.commit();
        success = true;
      } catch (dbError) {
        await transaction.rollback();
        logger.error(`[ERROR] DB 작업 중 오류 (키워드 ID ${keywordId}): ${dbError.message}`, dbError);
        errorDetails = `DB Error: ${dbError.message}`;
        throw dbError; // 에러를 다시 던져서 호출자가 처리하도록 함
      }
    } else {
      logger.info(`[INFO] 키워드 '${keyword}' (ID:${keywordId})에 대한 검색 결과 없음.`);
      // 검색 결과가 없는 경우: KeywordBasicCrawlResult 생성하지 않음 또는 필수 필드를 적절히 설정
      // 검색 결과가 없는 경우는 성공으로 간주하지만 별도 처리
      success = true; // 결과가 없는 것도 성공으로 간주 (크롤링 자체는 성공했으므로)
    }

    // 기본 크롤링 성공 시 키워드의 basic_last_crawled_date 업데이트
    if (success) {
      await updateKeywordBasicCrawled(keywordId);
    }

  } catch (err) {
    logger.error(`[ERROR] 키워드 '${keyword}' (ID:${keywordId}) 기본 크롤링 중 심각한 오류: ${err.message}`, err);
    success = false;
    errorDetails = err.message;
    // 여기서 에러를 다시 던져서 BullMQ가 재시도 등을 처리하도록 함
    throw err;
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    
    const statusMessage = success ? '성공' : '실패';
    logger.info(`[SUMMARY] 키워드 '${keyword}' 기본 크롤링 ${statusMessage} - 수집된 업체: ${crawledItemsCount}개${errorDetails ? `, 오류: ${errorDetails}` : ''}`);
  }

  return {
    success,
    keywordId,
    keyword,
    itemsCount: crawledItemsCount,
    error: errorDetails
  };
}