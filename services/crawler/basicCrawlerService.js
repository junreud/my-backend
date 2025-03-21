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
import KeywordCrawlResult from '../../models/KeywordCrawlResult.js';
import Keyword from '../../models/Keyword.js'; // Keyword 모델 추가
import { updateKeywordBasicCrawled } from './dbHelpers.js';


/**
 * 무한 스크롤 처리 함수
 */
async function performInfiniteScroll(page, itemSelector) {
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
    const currentCount = await page.$$eval(itemSelector, els => els.length);
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
        itemSelector,
        currentCount,
        MAX_ITEMS
      );
    } catch (err) {
      console.log('[DEBUG] 더 이상 증가 안 하거나, 타임아웃 → 체크 진행');
    }

    // 다시 아이템 개수 확인
    const newCount = await page.$$eval(itemSelector, els => els.length);
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
  return await page.$$eval(itemSelector, els => els.length);
}









export async function crawlKeywordBasic(keyword, keywordId, baseX = 126.9783882, baseY = 37.5666103) {
  let browser;
  let page;

  try {
    console.log(`[INFO][BasicCrawler] 키워드 "${keyword}" 기본 크롤링 시작`);

    // 1) 키워드 정보 확인
    let keywordObj;
    if (keywordId) {
      keywordObj = await Keyword.findByPk(keywordId);
      if (!keywordObj) {
        console.error(`[ERROR] 키워드 ID ${keywordId}를 찾을 수 없습니다.`);
        throw new Error(`키워드 ID ${keywordId}를 찾을 수 없습니다.`);
      }
      
      // 이미 basic_crawled=true인 경우 처리하지 않음
      if (keywordObj.basic_crawled) {
        console.log(`[INFO] 키워드 ID ${keywordId}는 이미 basic_crawled=true 상태입니다. 처리를 건너뜁니다.`);
        return [];
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
          isRestaurant: isRestaurantVal === 1 ? true : false,
          basic_crawled: false,
          detail_crawled: false
        });
        console.log(`[INFO] 새 키워드 "${keyword}" 생성됨, ID: ${keywordObj.id}`);
      } else if (keywordObj.basic_crawled) {
        console.log(`[INFO] 키워드 "${keyword}"는 이미 basic_crawled=true 상태입니다. 처리를 건너뜁니다.`);
        return [];
      }
      
      keywordId = keywordObj.id;
    }

    // 기존의 맛집 키워드 여부 확인 로직 사용
    const isRestaurantVal = keywordObj.isRestaurant ? 1 : 0;
    console.log(`[DEBUG] isRestaurantVal=${isRestaurantVal}`);

    // Puppeteer 옵션
    const launchOptions = {
      headless: 'new',
      args: []
    };
    if (PROXY_SERVER) {
      launchOptions.args.push(`--proxy-server=${PROXY_SERVER}`);
      console.log('[INFO] 프록시 사용:', PROXY_SERVER);
    }
    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();

    // 무작위 좌표
    const { randX, randY } = getRandomCoords(baseX, baseY, 300);
    console.log(`[DEBUG] 무작위 좌표: (x=${randX.toFixed(7)}, y=${randY.toFixed(7)})`);

    // 2) 검색 URL - 맛집 여부에 따라 경로 조정
    const encodedKeyword = encodeURIComponent(keyword);
    const route = isRestaurantVal === 1 ? 'restaurant' : 'place';

    // URL 구성 시 rank=저장많은 파라미터를 기본으로 포함
    let placeUrl = `https://m.place.naver.com/${route}/list?query=${encodedKeyword}&x=${randX}&y=${randY}&level=top&entry=pll`;
    console.log(`[DEBUG] 기본 정보 URL: ${placeUrl}`);
  
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
    console.log('[INFO] 페이지 이동:', placeUrl);
    await page.goto(placeUrl, { waitUntil: 'domcontentloaded' });

    // 목록 로딩 대기 - restaurant와 place에 따라 다른 셀렉터 사용
    console.log(`[INFO] ${isRestaurantVal === 1 ? '레스토랑' : '일반 장소'} 모드로 목록 셀렉터 확인`);

    // restaurant와 place에 따라 다른 셀렉터 직접 지정
    let listItemSelector;
    if (isRestaurantVal === 1) {
      // 레스토랑인 경우
      listItemSelector = 'li.UEzoS';
    } else {
      // 일반 장소인 경우
      listItemSelector = 'li.VLTHu';
    }

    console.log(`[INFO] 선택된 목록 셀렉터: ${listItemSelector}`);

    // 셀렉터가 존재하는지 확인
    try {
      // 먼저 셀렉터 대기
      console.log(`[INFO] ${listItemSelector} 셀렉터 대기 중... (최대 10초)`);
      await page.waitForSelector(listItemSelector, { timeout: 10000 });
      console.log('[INFO] 목록 페이지 로딩 완료');
      
      // 셀렉터 존재 확인 (여기서는 항상 true여야 함)
      const count = await page.$$eval(listItemSelector, els => els.length);
      console.log(`[INFO] ${listItemSelector} 셀렉터로 ${count}개 항목 발견됨`);
    } catch (err) {
      console.error(`[ERROR] 셀렉터 ${listItemSelector} 대기 중 오류 발생:`, err);
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
          // 일반 장소 셀렉터 - 클래스명이 다를 수 있음
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
      console.log('[INFO] 저장수 정보 페이지 이동:', savedUrl);
      
      // 새 페이지로 이동
      await page.goto(savedUrl, { waitUntil: 'domcontentloaded' });
      
      // 레스토랑은 항상 li.UEzoS 셀렉터 사용 (일반 장소인 경우 실행되지 않음)
      const savedListSelector = 'li.UEzoS';
      console.log(`[INFO] 저장순 페이지 목록 셀렉터: ${savedListSelector}`);
      
      // 목록 로딩 대기
      await page.waitForSelector(savedListSelector, { timeout: 10000 });
      
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
          console.log(`[DEBUG] href: ${href}`);
      
          const m = href.match(/\/(?:restaurant|place|cafe)\/(\d+)/);
          if (!m || !m[1]) continue;
          
          const placeId = m[1];
          
          // h69bs 클래스 요소 찾기
          const h69bsEl = item.querySelector('.h69bs');
          console.log(`[DEBUG] placeId: ${placeId}, h69bs 요소 존재: ${!!h69bsEl}`);
          
          if (h69bsEl) {
            const text = h69bsEl.textContent || '';
            console.log(`[DEBUG] placeId: ${placeId}, h69bs 텍스트: "${text}"`);
            
            const savedMatch = text.match(/저장\s*([,\d]+)\+?|리뷰\s*([,\d]+)/);
            console.log(`[DEBUG] placeId: ${placeId}, savedMatch: ${JSON.stringify(savedMatch)}`);
            
            if (savedMatch) {
              const countStr = savedMatch[1] || savedMatch[2] || '0';
              counts[placeId] = parseInt(countStr.replace(/,/g, ''), 10);
              console.log(`[DEBUG] placeId: ${placeId}, 추출된 저장수: ${counts[placeId]}`);
            }
          }
        }
        return counts;
      }, savedListSelector);
      
      console.log(`[INFO] 저장수 정보: ${Object.keys(savedCounts).length}개 항목`);
    }

    for (const item of items) {
      if (!item.placeId) continue;
      
      try {
        // 해당 placeId의 저장수 가져오기
        const savedCount = savedCounts[item.placeId] || 0;
        
        await KeywordCrawlResult.create({
          keyword_id: keywordId,
          place_id: parseInt(item.placeId, 10),
          place_name: item.name,
          category: item.category,
          ranking: item.rank,
          is_restaurant: isRestaurantVal === 1,
          savedCount: savedCount // 저장수 추가
        });
        
        console.log(`[DB:INSERT] 항목 저장 성공: place_id=${item.placeId}, place_name=${item.name}, rank=${item.rank}, savedCount=${savedCount}`);
      } catch (err) {
        console.error(`[ERROR] 항목 저장 실패 (placeId=${item.placeId}):`, err);
      }
    }

    // 기본 크롤링 완료 플래그 설정
    await updateKeywordBasicCrawled(keywordId);
    console.log(`[INFO][BasicCrawler] 키워드 "${keyword}" 기본 크롤링 완료, basic_crawled=true로 업데이트됨`);
    
    return items;
  } catch (err) {
    console.error(`[ERROR][BasicCrawler] 키워드 "${keyword}" 크롤링 실패:`, err);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      console.log('[INFO] 브라우저 종료');
    }
  }
}

/**
 * 모든 basic_crawled=false 키워드에 대해 기본 크롤링 실행
 */
export async function crawlAllPendingBasics() {
  // basic_crawled=false인 모든 키워드 찾기
  const pendingKeywords = await Keyword.findAll({
    where: {
      basic_crawled: false
    }
  });
  
  if (pendingKeywords.length === 0) {
    console.log('[INFO] 기본 크롤링이 필요한 키워드가 없습니다.');
    return;
  }
  
  console.log(`[INFO] 기본 크롤링이 필요한 키워드가 ${pendingKeywords.length}개 있습니다.`);
  
  // 각 키워드에 대해 순차적으로 기본 크롤링 실행
  for (const keyword of pendingKeywords) {
    console.log(`[INFO] 키워드 "${keyword.keyword}" (ID: ${keyword.id})에 대한 기본 크롤링 시작...`);
    await crawlKeywordBasic(keyword.keyword, keyword.id);
    
    // 각 키워드 사이에 딜레이 추가
    await randomDelay(2, 5);
  }
  
  console.log('[INFO] 모든 대기 중인 키워드의 기본 크롤링이 완료되었습니다.');
}
