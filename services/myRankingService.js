// services/myRankingService.js
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/** (공통) 일정 시간(ms) 대기 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** (공통) 지정된 컨테이너를 스크롤하여 추가 로딩을 유도 */
async function autoScrollContainer(page, containerSelector) {
  await page.evaluate(async (selector) => {
    const container = document.querySelector(selector);
    if (!container) {
      console.warn('[WARN] 컨테이너를 찾지 못함:', selector);
      return;
    }
    return new Promise((resolve) => {
      let lastScrollHeight = container.scrollHeight;
      let attempts = 0;
      const timer = setInterval(() => {
        container.scrollTop = container.scrollHeight;
        const newScrollHeight = container.scrollHeight;
        if (newScrollHeight === lastScrollHeight) {
          attempts++;
          // 연속 2회 이상 변화가 없으면 종료
          if (attempts >= 2) {
            clearInterval(timer);
            resolve();
          }
        } else {
          attempts = 0;
          lastScrollHeight = newScrollHeight;
        }
      }, 600);
    });
  }, containerSelector);
}

/**
 * (하나의 함수로 통합)
 *  1) placeUrl로 이동해서 최대 300위까지 업체 목록을 수집.
 *  2) placeUrl에 placeId 파라미터가 있다면, 그 업체가 몇 위인지 함께 찾음.
 *  3) 결과(전체 목록, 내 업체 정보)를 텍스트 파일로 기록 + JSON 형태 반환.
 *
 *  @param {string} placeUrl - 예) 'https://m.place.naver.com/restaurant/list?query=강남역+맛집&placeId=123456'
 *  @returns {object} {
 *      totalCount,         // (광고 제외) 실제 업체 목록 수
 *      items,              // [{ rank, name, category, link }, ...] (최대 300)
 *      myPlaceId,          // placeUrl에 placeId가 있으면
 *      myRanking,          // 내 업체 순위 (1~300), 없으면 '미노출'
 *      myName,
 *      myCategory
 *  }
 */
async function crawlPlaceAndFindMyRanking(placeUrl) {
  let browser;
  try {
    console.log('[INFO] crawlPlaceAndFindMyRanking ->', placeUrl);

    // placeId 추출 (URL에 ?placeId=123456 형태가 있다고 가정)
    const urlObj = new URL(placeUrl);
    const myPlaceId = urlObj.searchParams.get('placeId') || null;

    // Puppeteer 실행
    const launchOptions = {
      headless: true,  
      // 필요 시 args: ['--proxy-server=...']
    };
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // 모바일 UserAgent
    const MOBILE_USER_AGENT =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
      'Version/15.0 Mobile/15E148 Safari/604.1';
    await page.setUserAgent(MOBILE_USER_AGENT);

    // 페이지 이동
    await page.goto(placeUrl, { waitUntil: 'domcontentloaded' });

    // 스크롤 유도
    const containerSelector = '#_list_scroll_container';
    await autoScrollContainer(page, containerSelector);
    await sleep(700);

    // 광고 포함 전체 항목
    const allItems = await page.$$('li.UEzoS');
    console.log('[INFO] 총 항목(광고 포함) 개수:', allItems.length);

    // 광고 항목(클래스 'cZnHG') 제외
    const realItems = [];
    for (const item of allItems) {
      const className = await item.evaluate(el => el.className);
      if (!className.includes('cZnHG')) {
        realItems.push(item);
      }
    }
    console.log('[INFO] 광고 제외 후:', realItems.length);

    // 최대 300개
    const limitedItems = realItems.slice(0, 300);

    // 전체 목록 데이터
    const outputData = [];
    let myRanking = null;
    let myName = '';
    let myCategory = '';

    for (let i = 0; i < limitedItems.length; i++) {
      const el = limitedItems[i];
      const rank = i + 1;

      // 업체명
      let name = '';
      try {
        name = await el.$eval('.place_bluelink', e => e.textContent.trim());
      } catch (e) {
        name = '업체명 없음';
      }

      // 업종
      let category = '';
      try {
        category = await el.$eval('.KCMnt', e => e.textContent.trim());
      } catch (e) {
        category = '업종 정보 없음';
      }

      // 링크
      let link = '';
      try {
        link = await el.$eval('a', e => e.getAttribute('href'));
      } catch (e) {
        link = '';
      }

      outputData.push({ rank, name, category, link });

      // 내 placeId와 일치하는지 확인
      if (myPlaceId && link && link.includes(myPlaceId)) {
        myRanking = rank;
        myName = name;
        myCategory = category;
      }
    }

    // 파일 저장
    const now = new Date().toLocaleString();
    const filePath = path.join(process.cwd(), 'crawler_result.txt');

    // 헤더 정보
    const headerLines = [
      `크롤링 시각: ${now}`,
      `URL: ${placeUrl}`,
      `총 업체 수(광고 제외): ${outputData.length}`,
    ];
    if (myPlaceId) {
      headerLines.push(`내 placeId: ${myPlaceId}`);
      headerLines.push(`내 순위: ${myRanking || '미노출'}`);
    }
    headerLines.push('---------------------------------------\n');

    fs.appendFileSync(filePath, headerLines.join('\n'));

    // 목록 (최대 300)
    outputData.forEach(item => {
      const line = `${item.rank}위 | ${item.name} | ${item.category} | ${item.link}\n`;
      fs.appendFileSync(filePath, line);
    });
    fs.appendFileSync(filePath, '\n');

    // 결과 반환
    return {
      totalCount: outputData.length,
      items: outputData,
      myPlaceId,
      myRanking: myRanking || '미노출',
      myName,
      myCategory
    };
  } catch (error) {
    console.error('[ERROR] crawlPlaceAndFindMyRanking:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 모듈 내보내기
module.exports = {
  crawlPlaceAndFindMyRanking
};
