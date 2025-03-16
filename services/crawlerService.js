// crawlerService.js (ESM)
import puppeteer from 'puppeteer';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import Keyword from '../models/Keyword.js';

// *** Import from crawler.js ***
//   - getRandomUserAgentAndCookie: picks PC vs. mobile UA & cookie
//   - randomDelay, getRandomCoords remain the same
import {
  getRandomUserAgentAndCookie,
  getRandomCoords,
  randomDelay
} from '../config/crawler.js';

dotenv.config();

/** 1) DB 저장 함수 (예시) */
async function saveToDatabase(item, detailInfo) {
  console.log(`[DB] 저장: placeId=${item.placeId}, name=${item.name}, category=${item.category}`);
  console.log(`     상세타이틀=${detailInfo.title || ''}, 상세주소=${detailInfo.address || ''}`);
}

/** 2) 상세 페이지 HTML 가져오기 (with UA & Cookie) */
async function fetchDetailHtml(placeId, cookieStr, userAgent, isRestaurant) {
  const detailRoute = isRestaurant ? 'restaurant' : 'place';
  const detailUrl = `https://m.place.naver.com/${detailRoute}/${placeId}/home?entry=ple`;

  const resp = await fetch(detailUrl, {
    method: 'GET',
    headers: {
      'User-Agent': userAgent,
      // Use the same cookie session from file
      Cookie: cookieStr,
    },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch detail (status=${resp.status})`);
  }

  const html = await resp.text();
  return html;
}

/** 3) HTML 파싱 (간단) */
function parseDetailHtml(html) {
  let title = '';
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].replace(/ : 네이버 플레이스$/, '').trim();
  }

  let address = '';
  const addressMatch = html.match(/"address":"([^"]+)"/);
  if (addressMatch && addressMatch[1]) {
    address = addressMatch[1];
  }

  return { title, address };
}

/** 4) DB에서 isRestaurant 여부 가져오기 (Keyword 모델 예시) */
async function checkIsRestaurant(keyword) {
  const record = await Keyword.findOne({ where: { keyword } });
  return record ? (record.isRestaurant ? 1 : 0) : 0;
}

/**
 * 5) 주요 크롤링 함수
 *    - Integrates the "UA + Cookie" from crawler.js
 */
export async function crawlKeyword(keyword, baseX = 126.9783882, baseY = 37.5666103) {
  let browser;
  try {
    console.log('[INFO] crawlKeyword 시작');
    console.log(`  └─ 키워드: ${keyword}, baseX=${baseX}, baseY=${baseY}`);

    // (A) DB 조회 -> isRestaurant
    const isRestaurantVal = await checkIsRestaurant(keyword);
    console.log(`[DEBUG] isRestaurant(0/1):`, isRestaurantVal);

    // (B) 무작위 좌표 => imported getRandomCoords
    const { randX, randY } = getRandomCoords(baseX, baseY, 300);
    console.log(`[DEBUG] 무작위 좌표: (x=${randX.toFixed(7)}, y=${randY.toFixed(7)})`);

    // (C) 검색 URL
    const encodedKeyword = encodeURIComponent(keyword);
    const route = isRestaurantVal === 1 ? 'restaurant' : 'place';
    let placeUrl = `https://m.place.naver.com/${route}/list?query=${encodedKeyword}&x=${randX}&y=${randY}&level=top&entry=pll`;
    if (isRestaurantVal === 1) {
      placeUrl += '&rank=someValue';
    }
    console.log('[DEBUG] placeUrl:', placeUrl);

    // (D) 브라우저 띄우기
    const launchOptions = { headless: false, args: [] };
    if (process.env.PROXY_SERVER) {
      launchOptions.args.push(`--proxy-server=${process.env.PROXY_SERVER}`);
      console.log('[INFO] 프록시 사용:', process.env.PROXY_SERVER);
    }
    browser = await puppeteer.launch(launchOptions);
    console.log('[INFO] 브라우저 런치 완료');

    // 새 탭
    const page = await browser.newPage();

    // (★) Grab UA & Cookie from crawler.js
    const { ua, cookieStr } = getRandomUserAgentAndCookie();
    console.log('[INFO] [Crawler.js] Picked UA:', ua);
    console.log('[INFO] [Crawler.js] Using Cookie:', cookieStr);

    // Set the user agent from that random UA
    await page.setUserAgent(ua);

    // Convert cookieStr -> array of {name, value, domain, path}
    // so Puppeteer can set them
    const cookieArr = cookieStr.split('; ').map(pair => {
      const [name, value] = pair.split('=');
      // domain might be .naver.com if you want a broad match
      return { name, value, domain: '.naver.com', path: '/' };
    });

    // apply the cookies BEFORE navigation
    await page.setCookie(...cookieArr);

    // (E) 목록 페이지 이동
    console.log('[INFO] 페이지 이동:', placeUrl);
    await page.goto(placeUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('li.UEzoS', { timeout: 10000 });
    console.log('[INFO] 목록 페이지 로딩 완료.');

    // (F) 무한 스크롤
    console.log('[INFO] 무한 스크롤 시작');
    const scrollSel = '#_list_scroll_container';
    const MAX_ITEMS = 300;

    while (true) {
      const currentCount = await page.$$eval('li.UEzoS', els => els.length);
      if (currentCount >= MAX_ITEMS) {
        console.log(`[DEBUG] 아이템 개수 ${currentCount}, 최대 도달 → 중단`);
        break;
      }

      // 스크롤
      await page.evaluate((selector) => {
        const container = document.querySelector(selector);
        if (container) container.scrollTo(0, container.scrollHeight);
      }, scrollSel);

      try {
        await page.waitForFunction(
          (sel, prevCount, maxVal) => {
            const newCount = document.querySelectorAll(sel).length;
            return newCount > prevCount || newCount >= maxVal;
          },
          { timeout: 3000 },
          'li.UEzoS',
          currentCount,
          MAX_ITEMS
        );
      } catch (err) {
        console.log('[DEBUG] 더 이상 증가 안 하므로 중단');
        break;
      }
    }
    console.log('[INFO] 무한 스크롤 종료');

    // (G) placeId 추출
    const items = await page.$$eval(
      'li.UEzoS',
      (els, maxCount) => {
        const results = [];
        for (let i = 0; i < els.length && results.length < maxCount; i++) {
          const el = els[i];
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

          results.push({
            placeId: exPlaceId,
            name,
            category,
          });
        }
        return results;
      },
      MAX_ITEMS
    );

    console.log(`[INFO] 목록 파싱 완료: 광고 제외 업소 ${items.length}개`);

    if (items.length === 0) {
      console.log('[INFO] 검색 결과 없음.');
      return [];
    }

    // (H) 상세 페이지 가져와서 DB 저장
    let index = 0;
    while (index < items.length) {
      const batchSize = Math.floor(Math.random() * 8) + 5; // 5~12
      const slice = items.slice(index, index + batchSize);

      console.log(`[DEBUG] placeId 묶음 크기=${batchSize}, index=${index}~${index + batchSize - 1}`);

      const promises = slice.map(async (oneItem) => {
        try {
          if (!oneItem.placeId) return;

          // use same cookieStr + random UA again for detail calls
          const detailUA = getRandomUserAgentAndCookie().ua; 
          // or we can just reuse 'ua' if we want consistent UA...
          // but let's keep it random for each item.
          const detailHtml = await fetchDetailHtml(
            oneItem.placeId,
            cookieStr,
            detailUA,
            isRestaurantVal === 1
          );
          const detailInfo = parseDetailHtml(detailHtml);

          await saveToDatabase(oneItem, detailInfo);
        } catch (err) {
          console.error(`[ERROR] placeId=${oneItem.placeId} 상세 페이지 처리 중 오류:`, err);
        }
      });

      await Promise.all(promises);
      index += batchSize;

      // 다음 묶음 전 1~4초 대기
      if (index < items.length) {
        console.log('[DEBUG] 다음 묶음까지 대기 (1~4초)');
        await randomDelay(1, 4);
      }
    }

    console.log('[INFO] 모든 상세 정보 DB 저장 완료');
    return items;
  } catch (err) {
    console.error('[ERROR] crawlKeyword:', err);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      console.log('[INFO] 브라우저 종료');
    }
  }
}

/** 
 * 직접 실행 스크립트 (node services/crawlerService.js "키워드" 126.9784 37.5666)
 */
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  (async () => {
    const [, , inputKeyword, inputX, inputY] = process.argv;
    const keyword = inputKeyword || '사당 고기집';
    const xVal = inputX ? parseFloat(inputX) : 126.9783882;
    const yVal = inputY ? parseFloat(inputY) : 37.5666103;

    const result = await crawlKeyword(keyword, xVal, yVal);
    console.log('=== 최종 결과(리스트) ===');
    console.log(result);
  })();
}