/**
 * services/crawlerService.js
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PROXY_SERVER = '';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)...';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoScrollContainer(page, containerSelector) {
  await page.evaluate(async (selector) => {
    const container = document.querySelector(selector);
    if (!container) {
      console.warn('컨테이너를 찾지 못함:', selector);
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
 * runCrawler
 * @param {Object} options
 * @param {string} options.keyword
 * @param {string} options.targetPlaceId
 */
async function runCrawler(options) {
  const { keyword, targetPlaceId } = options;
  let browser;
  let competitorList = [];
  let rankIndex = -1;

  try {
    console.log(`[INFO] runCrawler: '${keyword}' 크롤링 시작`);

    const launchOptions = {
      headless: true
    };
    if (PROXY_SERVER) {
      launchOptions.args = [`--proxy-server=${PROXY_SERVER}`];
      console.log(`[INFO] 프록시 사용: ${PROXY_SERVER}`);
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setUserAgent(MOBILE_USER_AGENT);

    // 네이버 모바일 지도 검색 URL (예시)
    const searchUrl = `https://m.place.naver.com/restaurant/list?query=${encodeURIComponent(keyword)}&x=126.9783882&y=37.5666103&level=top`;
    console.log(`[INFO] 이동: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    await autoScrollContainer(page, '#_list_scroll_container');
    await sleep(2000);

    // 목록 추출
    const allItems = await page.$$('li.UEzoS');
    const realItems = [];
    for (const item of allItems) {
      const className = await item.evaluate(el => el.className);
      // 광고(className.includes('cZnHG')) 제외
      if (!className.includes('cZnHG')) {
        realItems.push(item);
      }
    }

    console.log(`[INFO] 광고 제외 후 실제 업체 개수: ${realItems.length}`);

    // 순회하며 타겟업체 찾기
    for (let i = 0; i < realItems.length; i++) {
      const item = realItems[i];
      const linkHref = await item.$eval('a', el => el.getAttribute('href'));
      const placeName = await item.$eval('.place_bluelink', el => el.textContent?.trim() || '');
      competitorList.push(placeName);

      if (linkHref && linkHref.includes(targetPlaceId)) {
        rankIndex = i;
        console.log(`[INFO] 타겟 업체 발견, 순위: ${i + 1}`);
      }
    }

    const rank = rankIndex !== -1 ? rankIndex + 1 : null;
    console.log(`[INFO] 최종 순위: ${rank ?? '미노출'}`);

    const now = new Date().toLocaleString();
    const outputLines = [
      `크롤링 시각: ${now}`,
      `키워드: ${keyword}`,
      `플레이스ID: ${targetPlaceId}`,
      `최종 순위: ${rank ?? '미노출'}`,
      `총 업체 수(광고 제외): ${realItems.length}`,
      `--------------------------------------------------\n`
    ];
    const filePath = path.join(process.cwd(), 'crawler_result.txt');
    fs.appendFileSync(filePath, outputLines.join('\n'));

    // 경쟁업체 목록에서 내 업체 제거
    if (rankIndex !== -1) {
      competitorList.splice(rankIndex, 1);
    }

    return {
      rank,
      competitorList
    };
  } catch (err) {
    console.error('[ERROR] 크롤링 에러:', err);
    return {
      rank: null,
      competitorList: []
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('[INFO] 브라우저 종료');
    }
  }
}

// CommonJS exports
module.exports = {
  runCrawler
};
