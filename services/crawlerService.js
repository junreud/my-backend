// services/crawlerService.js (ESM)
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { MOBILE_USER_AGENT, PROXY_SERVER } from '../config/crawler.js';
import dotenv from 'dotenv';

dotenv.config();

/** sleep */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 무작위 좌표 생성 (baseX, baseY) 중심으로 radiusM 안) */
function getRandomCoords(baseX, baseY, radiusM = 300) {
  const distance = Math.random() * radiusM;
  const angle = Math.random() * 2 * Math.PI;
  const lat0Rad = (baseY * Math.PI) / 180;

  const deltaLat = (distance * Math.cos(angle)) / 111320;
  const deltaLng =
    (distance * Math.sin(angle)) /
    (111320 * Math.cos(lat0Rad));

  return { randY: baseY + deltaLat, randX: baseX + deltaLng };
}

/**
 * (개선된) 상세 페이지에서 블로그리뷰수, 영수증리뷰수를 **병렬**로 가져오기 위해
 * 매번 새 탭을 열고 닫으면서 크롤링하는 함수
 *
 * @param {puppeteer.Browser} browser
 * @param {string|number} placeId
 * @returns {Object} { blogCount, receiptCount }
 */
async function getReviewCountsParallel(browser, placeId) {
  const detailUrl = `https://m.place.naver.com/restaurant/${placeId}/home`;
  let page;
  try {
    // 새 탭 생성
    page = await browser.newPage();
    // 모바일 에이전트 설정
    await page.setUserAgent(MOBILE_USER_AGENT);

    // 상세 페이지 이동
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('span.GHAhO', { timeout: 6000 });

    // 전체 텍스트에서 정규식 추출
    const bodyText = await page.evaluate(() => document.body.innerText);

    // 블로그리뷰
    let blogCount = 0;
    const blogMatch = bodyText.match(/블로그\s*리뷰\s*([\d,]+)/);
    if (blogMatch) {
      blogCount = parseInt(blogMatch[1].replace(/,/g, ''), 10);
    }

    // 영수증(방문자) 리뷰
    let receiptCount = 0;
    const receiptMatch = bodyText.match(/(영수증리뷰|방문자\s*리뷰)\s*([\d,]+)/);
    if (receiptMatch) {
      receiptCount = parseInt(receiptMatch[2].replace(/,/g, ''), 10);
    }

    return { blogCount, receiptCount };
  } catch (err) {
    console.error(`[ERROR] getReviewCountsParallel (placeId=${placeId}):`, err);
    // 에러 시 0으로 반환(혹은 throw 해도 됨)
    return { blogCount: 0, receiptCount: 0 };
  } finally {
    if (page) {
      await page.close();
    }
  }
}

/**
 * 메인 함수
 *  1) (myX, myY) 주변 300m 무작위 좌표로 검색
 *  2) 무한 스크롤 후, 최대 300개 placeId 수집
 *  3) 여러 탭을 병렬로 생성하여 상세 페이지 접속 → 리뷰 수 파싱
 *  4) 내 placeId 순위 계산
 */
export async function crawlPlaceAndFindMyRanking(keyword, placeId, myX, myY) {
  let browser;
  try {
    console.log('[INFO] crawlPlaceAndFindMyRanking 시작');
    console.log(`  └─ 키워드: ${keyword}, placeId: ${placeId}, x=${myX}, y=${myY}`);

    // 1) 무작위 좌표
    const { randX, randY } = getRandomCoords(myX, myY, 300);
    console.log(`[DEBUG] 무작위 좌표: (x=${randX.toFixed(7)}, y=${randY.toFixed(7)})`);

    // 2) 검색 URL
    const encodedKeyword = encodeURIComponent(keyword);
    const placeUrl = `https://m.place.naver.com/restaurant/list?query=${encodedKeyword}&x=${randX}&y=${randY}&level=top&entry=pll`;
    console.log('[DEBUG] placeUrl:', placeUrl);

    // Puppeteer 옵션
    const launchOptions = { headless: "new", args: [] };
    if (PROXY_SERVER) {
      launchOptions.args.push(`--proxy-server=${PROXY_SERVER}`);
      console.log('[INFO] 프록시 사용:', PROXY_SERVER);
    }
    browser = await puppeteer.launch(launchOptions);
    console.log('[INFO] 브라우저 런치 완료');

    // 리스트 페이지 전용 탭
    const page = await browser.newPage();
    await page.setUserAgent(MOBILE_USER_AGENT);
    console.log('[INFO] Mobile UserAgent 설정완료');

    // 3) 리스트 페이지 이동
    console.log('[INFO] 페이지 이동:', placeUrl);
    await page.goto(placeUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('li.UEzoS', { timeout: 10000 });

    // (디버깅용) HTML 저장
    const htmlContent = await page.content();
    fs.writeFileSync('debug_list.html', htmlContent, 'utf8');
    console.log('debug_list.html 저장 완료');

    // 무한 스크롤 (#_list_scroll_container)
    console.log('[INFO] 무한 스크롤 시작');
    const scrollSel = '#_list_scroll_container';
    let lastHeight = await page.evaluate((selector) => {
      const s = document.querySelector(selector);
      return s ? s.scrollHeight : 0;
    }, scrollSel);

    while (true) {
      await page.evaluate((selector) => {
        const s = document.querySelector(selector);
        if (s) s.scrollTo(0, s.scrollHeight);
      }, scrollSel);

      await sleep(2500);

      const newHeight = await page.evaluate((selector) => {
        const s = document.querySelector(selector);
        return s ? s.scrollHeight : 0;
      }, scrollSel);

      if (newHeight === lastHeight) break;
      lastHeight = newHeight;
    }
    console.log('[INFO] 무한 스크롤 종료');

    // 4) 리스트에서 placeId, 업체명, 업종만 추출 (광고 제외)
    const items = await page.$$eval('li.UEzoS', (els, maxCount) => {
      const results = [];
      for (let i=0; i<els.length && results.length<maxCount; i++) {
        const el = els[i];
        // 광고? data-laim-exp-id="undefined*e"
        const laimExpId = el.getAttribute('data-laim-exp-id');
        if (laimExpId === 'undefined*e') continue;

        // a 태그
        const aTag = el.querySelector('a');
        if (!aTag) continue;

        const href = aTag.getAttribute('href') || '';
        let exPlaceId = '';
        const m = href.match(/\/restaurant\/(\d+)/);
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
          category
        });
      }
      return results;
    }, 300);

    console.log(`[INFO] 리스트 파싱 완료. 광고제외 업소 ${items.length}개`);

    // 5) 상세 페이지 파싱 (병렬처리)
    //    => concurrency 제한: 5
    const CONCURRENCY = 20;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const slice = items.slice(i, i + CONCURRENCY);

      // 한 배치(최대 5개)씩 병렬처리
      await Promise.all(slice.map(async (one) => {
        if (!one.placeId) return;
        const { blogCount, receiptCount } = await getReviewCountsParallel(browser, one.placeId);
        one.blogReviewCount = blogCount;
        one.receiptReviewCount = receiptCount;
      }));
    }

    // 6) 내 placeId 순위 계산
    let rankIndex = -1;
    let placeName = '';
    let category = '';

    // 정렬/순서는 "파싱된 순서" 그대로
    for (let i=0; i<items.length; i++) {
      if (String(placeId) === items[i].placeId) {
        rankIndex = i;
        placeName = items[i].name;
        category = items[i].category;
        break;
      }
    }
    const rank = (rankIndex !== -1) ? (rankIndex + 1) : null;

    // 7) 결과 파일 기록
    const now = new Date().toLocaleString();
    const filePath = path.join(process.cwd(), 'crawler_result.txt');
    const headerLines = [
      `크롤링 시각: ${now}`,
      `키워드: ${keyword}`,
      `URL: ${placeUrl}`,
      `총 업체 수: ${items.length}`,
      `내 placeId: ${placeId}`,
      `내 순위: ${rank ?? '미노출'}`,
      `---------------------------------------\n`
    ];
    fs.appendFileSync(filePath, headerLines.join('\n'));

    items.forEach((it, idx) => {
      const line = `${idx+1}위 | ${it.name} | ${it.category} | placeId: ${it.placeId} | 블로그리뷰: ${it.blogReviewCount||0} | 영수증리뷰: ${it.receiptReviewCount||0}\n`;
      fs.appendFileSync(filePath, line);
    });
    fs.appendFileSync(filePath, '\n');
    console.log(`[INFO] 결과 파일 저장 완료: ${filePath}`);

    return {
      totalCount: items.length,
      items,
      myPlaceId: String(placeId),
      myRanking: rank ?? '미노출',
      myName: placeName,
      myCategory: category
    };
  } catch (err) {
    console.error('[ERROR] crawlPlaceAndFindMyRanking:', err);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      console.log('[INFO] 브라우저 종료');
    }
  }
}

/** 직접 실행 */
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  (async()=>{
    const [,, inputKeyword, inputPlaceId, inputX, inputY] = process.argv;
    const keyword = inputKeyword || '사당고기집';
    const pId = inputPlaceId || '36341235';
    const xVal = inputX ? parseFloat(inputX) : 126.9783882;
    const yVal = inputY ? parseFloat(inputY) : 37.5666103;
    const result = await crawlPlaceAndFindMyRanking(keyword, pId, xVal, yVal);
    console.log('=== 최종 결과 ===');
    console.log(result);
  })();
}
