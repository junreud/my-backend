import puppeteer from 'puppeteer';
import fetch from 'node-fetch'; 
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
// @models 경로 별칭을 실제 경로로 변경
import KeywordCrawlResult from '../../models/KeywordCrawlResult.js';
import Keyword from '../../models/Keyword.js'; // Import the Keyword model
import { checkIsRestaurantByDOM } from "../isRestaurantChecker.js";

// (★) crawler.js에서 가져온 함수들
import {
  getRandomCoords,
  randomDelay,
  loadMobileUAandCookies,
  PROXY_SERVER
} from '../../config/crawler.js';

dotenv.config();

/**
 * (추가) DFS로 keywordList를 찾는 함수
 *  - 어디에 keywordList가 숨어있든 Array 형태면 찾자
 */
function findKeywordListDfs(obj) {
  if (!obj || typeof obj !== 'object') return null;

  // 1) 바로 obj.keywordList가 배열이면 반환
  if (Array.isArray(obj.keywordList)) {
    return obj.keywordList;
  }

  // 2) 아니면 각 자식 key에 대해 재귀 탐색
  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== 'object') continue;
    // 만약 자식 key 이름이 'keywordList'고 배열이면 즉시 반환
    if (key === 'keywordList' && Array.isArray(value)) {
      return value;
    }
    // 그 외 재귀 탐색
    const found = findKeywordListDfs(value);
    if (found) {
      return found;
    }
  }

  return null; // 못 찾은 경우
}

async function fetchDetailHtml(placeId, cookieStr, userAgent, isRestaurantVal = false) {
  const route = isRestaurantVal ? 'restaurant' : 'place';
  const detailUrl = `https://m.place.naver.com/${route}/${placeId}/home`;
  
  const res = await fetch(detailUrl, {
    method: 'GET',
    headers: {
      'Cookie': cookieStr,
      'User-Agent': userAgent,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch detail for placeId=${placeId}: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  return html;
}

/** 
 * 상세 페이지 HTML에서 (방문자리뷰, 블로그리뷰, keywordList) 파싱
 */
function parseDetailHtml(html) {
  let metaDesc = '';
  let visitorReviewCount = 0;  // 방문자리뷰 수
  let blogReviewCount = 0;

  // 메타태그 파싱 로직
  const metaDescRegex = /<meta[^>]+property="og:description"[^>]+content="([^"]+)"[^>]*>/i;
  const metaMatch = html.match(metaDescRegex);
  if (metaMatch && metaMatch[1]) {
    metaDesc = metaMatch[1].trim();

    // '방문자리뷰 X,XXX'
    const visitorMatch = metaDesc.match(/방문자리뷰\s+([\d,]+)/);
    if (visitorMatch && visitorMatch[1]) {
      visitorReviewCount = parseInt(visitorMatch[1].replace(/,/g, ''), 10);
    }

    // '블로그리뷰 X,XXX'
    const blogMatch = metaDesc.match(/블로그리뷰\s+([\d,]+)/);
    if (blogMatch && blogMatch[1]) {
      blogReviewCount = parseInt(blogMatch[1].replace(/,/g, ''), 10);
    }
  }

  // window.__APOLLO_STATE__에서 keywordList 추출 (DFS)
  let keywordList = [];
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (apolloMatch && apolloMatch[1]) {
    try {
      const apolloState = JSON.parse(apolloMatch[1]);
      const found = findKeywordListDfs(apolloState);
      if (Array.isArray(found)) {
        keywordList = found;
      }
    } catch (e) {
      console.warn('[WARN] parseDetailHtml - JSON 파싱 실패:', e);
    }
  }

  return {
    visitorReviewCount,
    blogReviewCount,
    keywordList
  };
}

/**
 * 키워드로 DB에서 검색하거나 새로 생성하여 ID 반환
 */
async function getOrCreateKeyword(keywordText, isRestaurantVal) {
  try {
    // 키워드로 검색
    let keyword = await Keyword.findOne({ 
      where: { keyword: keywordText }
    });
    
    // 키워드가 없으면 생성
    if (!keyword) {
      console.log(`[INFO] 키워드 "${keywordText}" DB에 없어서 새로 생성합니다.`);
      keyword = await Keyword.create({
        keyword: keywordText,
        isRestaurant: isRestaurantVal === 1 ? true : false
      });
    }
    
    return keyword.id;
  } catch (err) {
    console.error(`[ERROR] 키워드 "${keywordText}" 조회/생성 중 오류:`, err);
    throw err;
  }
}

/**
 * 키워드의 last_crawled_date 업데이트
 */
async function updateKeywordLastCrawled(keywordId) {
  try {
    await Keyword.update(
      { last_crawled_date: new Date() },
      { where: { id: keywordId } }
    );
    console.log(`[INFO] 키워드 ID ${keywordId}의 last_crawled_date 업데이트 완료`);
    return true;
  } catch (err) {
    console.error(`[ERROR] 키워드 ID ${keywordId}의 last_crawled_date 업데이트 실패:`, err);
    return false;
  }
}

// 키워드의 기본 크롤링 상태 업데이트
async function updateKeywordBasicCrawled(keywordId) {
  try {
    await Keyword.update(
      { 
        basic_crawled: true,
        last_crawled_date: new Date() 
      },
      { where: { id: keywordId } }
    );
    console.log(`[INFO] 키워드 ID ${keywordId}의 basic_crawled 상태 업데이트 완료`);
    return true;
  } catch (err) {
    console.error(`[ERROR] 키워드 ID ${keywordId}의 basic_crawled 상태 업데이트 실패:`, err);
    return false;
  }
}

// 키워드의 상세 크롤링 상태 업데이트
async function updateKeywordDetailCrawled(keywordId) {
  try {
    await Keyword.update(
      { 
        detail_crawled: true,
        last_crawled_date: new Date() 
      },
      { where: { id: keywordId } }
    );
    console.log(`[INFO] 키워드 ID ${keywordId}의 detail_crawled 상태 업데이트 완료`);
    return true;
  } catch (err) {
    console.error(`[ERROR] 키워드 ID ${keywordId}의 detail_crawled 상태 업데이트 실패:`, err);
    return false;
  }
}

// 수정된 코드: 기본 정보를 즉시 DB에 저장하는 함수 추가
async function saveBasicInfoToDatabase(keywordId, item) {
  try {
    // 기본 정보만 포함하여 DB에 저장
    const result = await KeywordCrawlResult.create({
      keyword_id: keywordId,
      place_id: parseInt(item.placeId, 10),
      category: item.category || null,
      place_name: item.name || null,
      ranking: item.rank || 0,
      // 나머지 필드는 기본값 또는 null로 설정
      blog_review_count: 0,
      receipt_review_count: 0,
      savedCount: item.savedCount || 0,
      keywordList: null,

    });
    
    console.log(`[DB:INSERT] 기본 정보 저장 성공: place_id=${item.placeId}, place_name=${item.name}, rank=${item.rank}`);
    return result.id; // 생성된 레코드의 ID 반환 (나중에 업데이트에 사용)
  } catch (err) {
    console.error(`[ERROR] 기본 정보 DB 저장 실패 (placeId=${item.placeId}):`, err);
    return null;
  }
}
// 상세 정보로 DB 레코드 업데이트하는 함수
async function updateWithDetailInfo(recordId, detailInfo, savedCount = 0) {
  try {
    await KeywordCrawlResult.update(
      {
        blog_review_count: detailInfo.blogReviewCount || 0,
        receipt_review_count: detailInfo.visitorReviewCount || 0,
        savedCount: savedCount || 0,
        keywordList: Array.isArray(detailInfo.keywordList) ? 
                    JSON.stringify(detailInfo.keywordList) : null,
        detail_crawled: true
      },
      { where: { id: recordId } }
    );
    
    console.log(`[DB:UPDATE] 상세 정보 업데이트 성공: recordId=${recordId}`);
    return true;
  } catch (err) {
    console.error(`[ERROR] 상세 정보 업데이트 실패 (recordId=${recordId}):`, err);
    return false;
  }
}
/**
 * 키워드 -> 무한스크롤 -> 최대 300개 -> 각각 detail 파싱 후 DB 저장
 */
export async function crawlKeyword(keyword, keywordId = null, baseX = 126.9783882, baseY = 37.5666103) {
  let browser;
  let page;
  let placeUrlAgain = '';
  let keywordIdToUse = keywordId;
  
  try {
    console.log('[INFO] crawlKeyword 시작');
    console.log(`  └─ 키워드: ${keyword}, baseX=${baseX}, baseY=${baseY}`);

    // 1) isRestaurant 여부
    const isRestaurantVal = await checkIsRestaurantByDOM(keyword);
    console.log(`[DEBUG] isRestaurantVal=${isRestaurantVal}`);
    
    // 키워드 ID가 전달되지 않았으면 DB에서 조회 또는 생성
    if (!keywordIdToUse) {
      keywordIdToUse = await getOrCreateKeyword(keyword, isRestaurantVal);
      console.log(`[INFO] 키워드 ID: ${keywordIdToUse}`);
    }

    // 2) 무작위 좌표 (crawler.js)
    const { randX, randY } = getRandomCoords(baseX, baseY, 300);
    console.log(`[DEBUG] 무작위 좌표: (x=${randX.toFixed(7)}, y=${randY.toFixed(7)})`);

    // 3) 검색 URL
    const encodedKeyword = encodeURIComponent(keyword);
    const route = isRestaurantVal === 1 ? 'restaurant' : 'place';
    let placeUrl = `https://m.place.naver.com/${route}/list?query=${encodedKeyword}&x=${randX}&y=${randY}&level=top&entry=pll`;
    if (isRestaurantVal === 1) {
      placeUrl += '&rank=someValue';
    }
    console.log('[DEBUG] placeUrl:', placeUrl);

    // 4) Puppeteer 실행
    const launchOptions = { headless: 'new', args: [] };
    if (PROXY_SERVER && PROXY_SERVER.trim() !== '') {
      launchOptions.args.push(`--proxy-server=${PROXY_SERVER}`);
      console.log('[INFO] 프록시 사용:', PROXY_SERVER);
    }
    browser = await puppeteer.launch(launchOptions);
    console.log('[INFO] 브라우저 런치 완료');

    // (★) 5) PC vs 모바일 쿠키/UA를 랜덤 적용
    let ua, cookieStr;
    // 모바일 UA/쿠키
    ({ ua, cookieStr } = loadMobileUAandCookies());
    console.log('[INFO] 모바일 UA 선택:', ua);

    page = await browser.newPage();
    await page.setUserAgent(ua);

    // 쿠키 적용
    const cookieArr = cookieStr.split('; ').map(pair => {
      const [name, value] = pair.split('=');
      return { name, value, domain: '.naver.com', path: '/' };
    });
    await page.setCookie(...cookieArr);

    // 6) 페이지 이동
    console.log('[INFO] 페이지 이동:', placeUrl);
    await page.goto(placeUrl, { waitUntil: 'domcontentloaded' });

    // 목록 로딩 대기
    await page.waitForSelector('li.UEzoS', { timeout: 10000 });
    console.log('[INFO] 목록 페이지 로딩 완료.');

    // (★) 처음 화면 입장 후 잠시 대기
    await randomDelay(1, 2);
    console.log('[DEBUG] 초기 진입 후 대기 완료');

    // 7) 무한 스크롤
    console.log('[INFO] 무한 스크롤 시작');
    const scrollSel = '#_list_scroll_container';
    const MAX_ITEMS = 300;

    let previousCount = 0;
    let noChangeCount = 0;
    const MAX_NOCHANGE = 3; // 3번 연속 변화 없으면 중단
    let iteration = 0;
    const MAX_ITERATION = 20; // 20번까지 반복

    while (true) {
      iteration++;

      // 현재 아이템 수
      const currentCount = await page.$$eval('li.UEzoS', els => els.length);
      if (currentCount >= MAX_ITEMS) {
        console.log(`[DEBUG] 아이템 개수 ${currentCount}, 최대 도달 → 중단`);
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
          (sel, prevCount, maxVal) => {
            const newCount = document.querySelectorAll(sel).length;
            return newCount > prevCount || newCount >= maxVal;
          },
          {
            timeout: 7000, 
          },
          'li.UEzoS',
          currentCount,
          MAX_ITEMS
        );
      } catch (err) {
        console.log('[DEBUG] 더 이상 증가 안 하거나, 타임아웃 → 체크 진행');
      }

      // 다시 아이템 개수 확인
      const newCount = await page.$$eval('li.UEzoS', els => els.length);
      if (newCount > previousCount) {
        console.log(`[DEBUG] 아이템 개수 증가: ${previousCount} -> ${newCount}`);
        previousCount = newCount;
        noChangeCount = 0;
      } else {
        noChangeCount++;
        console.log(`[DEBUG] 아이템 개수 변동 없음: ${newCount}, noChangeCount=${noChangeCount}`);
      }

      if (iteration >= MAX_ITERATION || noChangeCount >= MAX_NOCHANGE) {
        console.log(`[DEBUG] 무한 스크롤 중단: iteration=${iteration}, noChangeCount=${noChangeCount}`);
        break;
      }
    }

    console.log('[INFO] 무한 스크롤 종료');

    // 8) placeId 추출
    const items = await page.$$eval('li.UEzoS', (els, maxCount) => {
      const results = [];
      for (let i = 0; i < els.length && results.length < maxCount; i++) {
        const el = els[i];
        // 광고는 data-laim-exp-id="undefined*e" 형태 → 제외
        const laimExpId = el.getAttribute('data-laim-exp-id');
        if (laimExpId === 'undefined*e') continue;
    
        const aTag = el.querySelector('a');
        if (!aTag) continue;
    
        const href = aTag.getAttribute('href') || '';
        let exPlaceId = '';
        const m = href.match(/\/(?:restaurant|place)\/(\d+)/);
        if (m && m[1]) {
          exPlaceId = m[1];
        }
    
        const nameEl = el.querySelector('span.TYaxT');
        const name = nameEl ? nameEl.textContent.trim() : '';
        const catEl = el.querySelector('.KCMnt');
        const category = catEl ? catEl.textContent.trim() : '';
    
        // 순위는 결과 배열의 길이 + 1 (1부터 시작하는 순위)
        const rank = results.length + 1;
    
        results.push({
          placeId: exPlaceId,
          name,
          category,
          rank // 순위 정보 추가
        });
      }
      return results;
    }, MAX_ITEMS);


    console.log(`[INFO] 기본 정보 DB 저장 시작: ${items.length}개 항목`);
    const recordMap = new Map(); // place_id와 DB record ID 매핑 저장

    // 기본 정보 저장 후 바로 상태 업데이트
    for (const item of items) {
      if (!item.placeId) continue;
      const recordId = await saveBasicInfoToDatabase(keywordIdToUse, item);
      if (recordId) {
        recordMap.set(item.placeId, recordId);
      }
    }

    // 기본 정보 크롤링이 완료되면 키워드 상태 업데이트
    await updateKeywordBasicCrawled(keywordIdToUse);
    console.log(`[INFO] 기본 정보 DB 저장 완료: ${recordMap.size}개 항목 성공`);

    // (★) 음식점이면 “&rank=저장하기”로 재검색 후 저장수 파싱
    if (isRestaurantVal === 1) {
        const placeUrlAgain = `https://m.place.naver.com/${route}/list?query=${encodedKeyword}&x=${randX}&y=${randY}&menu=${encodedKeyword}&order=false&rank=저장많은&keywordFilter=voting%5Efalse&level=top&entry=pll`;        
        console.log('[DEBUG] placeUrlAgain:', placeUrlAgain);
    
        await page.goto(placeUrlAgain, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('li.UEzoS', { timeout: 10000 });
        console.log('[INFO] 저장수 파싱용 페이지 로딩 완료');
        
        // 초기 로딩된 아이템 수 즉시 확인
        const initialCount = await page.$$eval('li.UEzoS', els => els.length);
        console.log(`[DEBUG][2차 페이지] 초기 로딩된 아이템 수: ${initialCount}`);
        
        // 2차 페이지 무한 스크롤 - 이미 300개가 로드되었으면 스킵
        if (initialCount < MAX_ITEMS) {
            const scrollSel2 = '#_list_scroll_container';
            let prevCount2 = initialCount;
            let noChangeCount2 = 0;
            const MAX_NOCHANGE_2 = 2; // 더 빨리 중단하도록 값 축소
            const MAX_ITERATION_2 = 10; // 최대 반복 횟수 줄임
            let iteration2 = 0;
            const MAX_ITEMS_2 = MAX_ITEMS;
            
            // 짧은 대기 후 진행
            await randomDelay(0.3, 0.5);
            
            while (true) {
                iteration2++;
            
                // 스크롤 전 현재 아이템 수 확인
                const currentCount2 = await page.$$eval('li.UEzoS', els => els.length);
                if (currentCount2 >= MAX_ITEMS_2) {
                    console.log(`[DEBUG][2차 페이지] 아이템 개수 ${currentCount2}, 최대 도달 -> 중단`);
                    break;
                }
            
                // 스크롤 내리기
                await page.evaluate(selector => {
                    const container = document.querySelector(selector);
                    if (container) {
                        container.scrollTo(0, container.scrollHeight);
                    }
                }, scrollSel2);
            
                // 짧은 타임아웃으로 변경 (1초로 축소)
                try {
                    await page.waitForFunction(
                        (sel, prevCount, maxVal) => {
                            const newCount = document.querySelectorAll(sel).length;
                            return newCount > prevCount || newCount >= maxVal;
                        },
                        { timeout: 1000 }, // 타임아웃 시간 1초로 축소
                        'li.UEzoS',
                        currentCount2,
                        MAX_ITEMS_2
                    );
                } catch (err) {
                    console.log('[DEBUG][2차페이지] 더 이상 증가 안함');
                }
            
                // 스크롤 후 아이템 개수 확인
                const newCount2 = await page.$$eval('li.UEzoS', els => els.length);
                if (newCount2 > prevCount2) {
                    console.log(`[DEBUG][2차 페이지] 아이템 개수 증가: ${prevCount2} -> ${newCount2}`);
                    prevCount2 = newCount2;
                    noChangeCount2 = 0;
                } else {
                    noChangeCount2++;
                    console.log(`[DEBUG][2차 페이지] 아이템 변동 없음: ${newCount2}, noChangeCount2=${noChangeCount2}`);
                }
            
                // 중단 조건 확인
                if (iteration2 >= MAX_ITERATION_2 || noChangeCount2 >= MAX_NOCHANGE_2) {
                    console.log('[DEBUG][2차 페이지] 무한 스크롤 중단');
                    break;
                }
            }
        } else {
            console.log(`[DEBUG][2차 페이지] 이미 충분한 아이템(${initialCount}개)이 로드됨 - 무한 스크롤 건너뜀`);
        }
        
        // 저장수 파싱 로직은 그대로 유지
        const saveItems = await page.evaluate(() => {
            const results = [];
            const listEls = document.querySelectorAll('li.UEzoS');
            
            listEls.forEach(el => {
              const aTag = el.querySelector('a');
              if (!aTag) return;
          
              const href = aTag.getAttribute('href') || '';
              const m = href.match(/\/(?:restaurant|place)\/(\d+)/);
              if (!m || !m[1]) return;
          
              const placeId = m[1];
              let savedCount = 0;
          
              // 전체 텍스트 확인용
              const allText = el.textContent || '';
              console.log(`placeId=${placeId} 전체 텍스트:`, allText); // 디버깅 용도
          
              // 정규식 시도
              const saveMatch = allText.match(/저장수\s*([\d,]+)\+?/);            
              if (saveMatch && saveMatch[1]) {
                savedCount = parseInt(saveMatch[1].replace(/,/g, ''), 10);
              }
          
              console.log(`placeId=${placeId} => savedCount: ${savedCount}`);
              results.push({ placeId, savedCount });
            });
            return results;
          });
    
        // 기존 items와 매칭해 savedCount 추가
        items.forEach(item => {
            const matched = saveItems.find(si => si.placeId === item.placeId);
            item.savedCount = matched ? matched.savedCount : 0;
            item.savePlaceId = matched ? matched.placeId : item.placeId;
        });
    }

    console.log(`[INFO] 목록 파싱 완료: 광고 제외 업소 ${items.length}개`);

    if (items.length === 0) {
      console.log('[INFO] 검색 결과 없음.');
      return [];
    }

    // 9) 첫 번째 업체 상세 클릭 -> 혹시 추가 쿠키 변동 있을 수 있음
    console.log('[INFO] 첫번째 업체 상세 클릭(쿠키 확보용)');
    await page.click('li.UEzoS:nth-child(1) a');
    await randomDelay(0.5, 1);

    // Puppeteer 쿠키 (추가/갱신분)
    const clientCookies = await page.cookies();
    let mergedCookieStr = cookieStr;
    for (const ck of clientCookies) {
      if (!mergedCookieStr.includes(`${ck.name}=`)) {
        mergedCookieStr += `; ${ck.name}=${ck.value}`;
      }
    }
    console.log('[INFO] 최종 쿠키:', mergedCookieStr);
    // 페이지 닫기를 환경변수에 따라 조건부로 실행
 

    // 10) 각 placeId 상세 GET -> parse -> DB
    let index = 0;
    const failedList = [];
    const successCount = { total: 0, db: 0 };
    
    while (index < items.length) {
      const batchSize = 7; // 5개씩
      const slice = items.slice(index, index + batchSize);

      console.log(`[DEBUG] placeId 묶음 크기=${batchSize}, index=${index}..${index+batchSize-1}`);

      const promises = slice.map(async (oneItem) => {
        try {
          if (!oneItem.placeId) return;

          // recordMap에서 해당 placeId의 레코드 ID 찾기
          const recordId = recordMap.get(oneItem.placeId);
          if (!recordId) {
            console.log(`[WARN] placeId=${oneItem.placeId}에 대한 DB 레코드를 찾을 수 없음`);
            return;
          }
          
          const detailHtml = await fetchDetailHtml(
            oneItem.placeId,
            mergedCookieStr,
            ua,
            (isRestaurantVal === 1)
          );
          const detailInfo = parseDetailHtml(detailHtml);
          
          // 상세 정보로 기존 레코드 업데이트
          const updateResult = await updateWithDetailInfo(
            recordId,
            detailInfo,
            oneItem.savedCount || 0
          );
      
          successCount.total++;
          if (updateResult) successCount.db++;
          
        } catch (err) {
          console.error(`[ERROR] placeId=${oneItem.placeId} 상세 페이지 처리 중 오류:`, err);
          failedList.push({...oneItem, recordId: recordMap.get(oneItem.placeId)});
        }
      });
      await Promise.all(promises);

      index += batchSize;
      if (index < items.length) {
        console.log(`[DEBUG] 다음 묶음(${batchSize}개) 처리 후 대기: 0.1~0.7초`);
        await randomDelay(0.3, 0.6);
      }
    }
    
    // 상세 정보 크롤링이 완료되면 키워드 상태 업데이트
    if (successCount.db > 0) {
      await updateKeywordDetailCrawled(keywordIdToUse);
    }
    
    // (★) 재시도 로직
    if (failedList.length > 0) {
      console.log(`[INFO] 1차 처리 중 오류였던 placeId ${failedList.length}개 재시도합니다 (batch size: 5).`);
      let firstRetryFailedList = [];
      const batchSizeRetry = 5;
      
      for (let i = 0; i < failedList.length; i += batchSizeRetry) {
        const batch = failedList.slice(i, i + batchSizeRetry);
        const retryPromises = batch.map(async (oneItem) => {
          try {
            await randomDelay(0.7, 0.9);
            const detailHtml = await fetchDetailHtml(
              oneItem.placeId,
              mergedCookieStr,
              ua,
              (isRestaurantVal === 1)
            );
            const detailInfo = parseDetailHtml(detailHtml);
            
            // recordId가 있는지 확인
            const recordId = oneItem.recordId || recordMap.get(oneItem.placeId);
            if (!recordId) {
              console.log(`[WARN] 재시도: placeId=${oneItem.placeId}에 대한 DB 레코드ID를 찾을 수 없음`);
              return;
            }
            
            // 상세 정보 업데이트
            const updateResult = await updateWithDetailInfo(
              recordId,
              detailInfo,
              oneItem.savedCount || 0
            );
            
            if (updateResult) successCount.db++;
            console.log(`[INFO] 1차 재시도 성공: placeId=${oneItem.placeId}`);
            
          } catch (err) {
            console.error(`[ERROR][1차 재시도] placeId=${oneItem.placeId} 실패:`, err);
            firstRetryFailedList.push(oneItem);
          }
        });
        
        await Promise.all(retryPromises);
        // 각 배치 사이에 약간의 지연 추가
        if (i + batchSizeRetry < failedList.length) {
          await randomDelay(0.5, 0.8);
        }
      }
      
      // 1차 재시도에도 실패한 항목들에 대해 2차 재시도 진행
      if (firstRetryFailedList.length > 0) {
        console.log(`[INFO] 1차 재시도 후에도 오류가 발생한 placeId ${firstRetryFailedList.length}개에 대해 2차 재시도 진행합니다.`);
        let finalFailCount = 0;
        
        for (const oneItem of firstRetryFailedList) {
          try {
            await randomDelay(1, 1.3);
            const detailHtml = await fetchDetailHtml(
              oneItem.placeId,
              mergedCookieStr,
              ua,
              (isRestaurantVal === 1)
            );
            const detailInfo = parseDetailHtml(detailHtml);
            
            // recordId가 있는지 확인
            const recordId = oneItem.recordId || recordMap.get(oneItem.placeId);
            if (!recordId) {
              console.log(`[WARN] 2차 재시도: placeId=${oneItem.placeId}에 대한 DB 레코드ID를 찾을 수 없음`);
              finalFailCount++;
              continue;
            }
            
            // DB 저장 - keywordCrawlId를 keywordIdToUse로 수정
            const updateResult = await updateWithDetailInfo(
              recordId,
              detailInfo,
              oneItem.savedCount || 0
            );
            
            if (updateResult) {
              successCount.db++;
              console.log(`[INFO] 2차 재시도 성공: placeId=${oneItem.placeId}`);
            } else {
              finalFailCount++;
              console.log(`[WARN] 2차 재시도 DB 업데이트 실패: placeId=${oneItem.placeId}`);
            }
            
          } catch (err) {
            finalFailCount++;
            console.error(`[ERROR][2차 재시도] placeId=${oneItem.placeId} 최종 실패:`, err);
            
            // 최종 실패시에도 DB에 실패 상태 기록 시도
            try {
              const recordId = oneItem.recordId || recordMap.get(oneItem.placeId);
              if (recordId) {
                await KeywordCrawlResult.update(
                  { detail_crawled: false },
                  { where: { id: recordId } }
                );
                console.log(`[INFO] placeId=${oneItem.placeId}의 detail_crawled 상태를 false로 기록`);
              }
            } catch (dbErr) {
              console.error(`[ERROR] 실패 상태 기록 중 오류: ${dbErr.message}`);
            }
          }
        }
        
        console.log(`[INFO] 2차 재시도 결과: 총 ${firstRetryFailedList.length}개 중 ${firstRetryFailedList.length - finalFailCount}개 성공, ${finalFailCount}개 최종 실패`);
      }
    }
    
    // 크롤링이 성공적으로 완료되었으면 키워드의 last_crawled_date 업데이트
    if (successCount.db > 0) {
      await updateKeywordLastCrawled(keywordIdToUse);
      console.log(`[INFO] 크롤링 완료: 키워드(ID: ${keywordIdToUse})의 최종 업데이트 시간 갱신`);
    }
    
    console.log(`[INFO] 모든 항목 처리 완료: ${successCount.db}개 항목이 DB에 저장됨`);
    return items;

  } catch (err) {
    console.error('[ERROR] crawlKeyword:', err);
    throw err;
  } finally {
    if (process.env.KEEP_BROWSER === 'true') {
      console.log('[INFO] 브라우저 유지 모드 - 저장많은 URL을 확인한 후 Enter 키를 누르면 종료됩니다.');
      // 저장많은 URL 로그 출력
      console.log('[INFO] 저장많은 URL:', placeUrlAgain);
      
      // 페이지가 아직 열려있을 때만 저장많은 URL로 다시 이동
      if (page && !page.isClosed()) {
        await page.goto(placeUrlAgain);
      }
      
      // 프로세스를 계속 실행 상태로 유지
      await new Promise(resolve => {
        process.stdin.once('data', () => {
          if (browser) {
            browser.close().then(() => {
              console.log('[INFO] 브라우저 종료');
              resolve();
            });
          } else {
            resolve();
          }
        });
      });
    } else if (browser) {
      await browser.close();
      console.log('[INFO] 브라우저 종료');
    }
  }
}
/**
 * 직접 실행 예시:
 *   node services/crawlerService.js "키워드" 126.9784 37.5666
 */
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  (async () => {
    const [,, inputKeyword, inputKeywordId, inputX, inputY] = process.argv;

    const keyword = inputKeyword || '사당 고기집';
    const keywordId = inputKeywordId ? parseInt(inputKeywordId, 10) : null;
    const xVal = inputX ? parseFloat(inputX) : 126.9783882;
    const yVal = inputY ? parseFloat(inputY) : 37.5666103;

    console.log(`[INFO] 키워드: ${keyword}, 키워드 ID: ${keywordId || '자동 할당'}`);
    const result = await crawlKeyword(keyword, keywordId, xVal, yVal);
    console.log('=== 최종 결과(리스트) ===');
    console.log(`총 ${result.length}개 항목 처리 완료`);
  })();
}