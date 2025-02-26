// services/placeInfoService.js
const puppeteer = require('puppeteer');
const { MOBILE_USER_AGENT, PROXY_SERVER } = require('../config/crawler');

/**
 * 네이버 플레이스 URL(모바일 버전)에서
 *  - 홈 탭(/home) → 업체 기본 정보, 메뉴 목록, ...
 *  - 정보 탭(/information) → 소개글
 *  - 리뷰 탭(/review/ugc?type=photoView) → 블로그 리뷰 제목
 *
 * @param {string} inputUrl
 * @returns {Promise<{
 *    placeId: string,
 *    name: string,
 *    category: string,
 *    address: string,
 *    x: number, // 경도
 *    y: number, // 위도
 *    menuList: Array<{ name: string, price: string, description: string, images: any[] }>,
 *    introduction: string,
 *    blogReviewTitles: string[]
 * } | null>}
 */
async function getPlaceInfoFromUrl(inputUrl) {
  let browser = null;

  try {
    // Puppeteer 브라우저 실행
    const launchOptions = { headless: true };
    if (PROXY_SERVER) {
      launchOptions.args = [`--proxy-server=${PROXY_SERVER}`];
    }
    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setUserAgent(MOBILE_USER_AGENT);

    // ──────────────────────────────────────────
    // 1) 홈 탭 (/home)
    // ──────────────────────────────────────────
    await page.goto(inputUrl, { waitUntil: 'networkidle2' });

    // Apollo State 로딩 대기
    await page.waitForFunction(() => window.__APOLLO_STATE__ !== undefined, { timeout: 10000 });
    const apolloDataHome = await page.evaluate(() => window.__APOLLO_STATE__ || null);
    if (!apolloDataHome) return null;

    // 파싱: placeId, name, category, address, x, y, menuList
    let placeId = '', name = '', category = '', address = '';
    let x = 0, y = 0;
    let menuList = [];

    // PlaceDetailBase 키 찾기
    const placeBaseKey = Object.keys(apolloDataHome).find(k => k.startsWith('PlaceDetailBase:'));
    if (placeBaseKey) {
      const placeInfo = apolloDataHome[placeBaseKey] || {};
      placeId  = placeInfo.id || '';
      name     = placeInfo.name || '';
      category = placeInfo.category || '';
      address  = placeInfo.roadAddress || placeInfo.address || '';
      if (placeInfo.coordinate && placeInfo.coordinate.x && placeInfo.coordinate.y) {
        x = parseFloat(placeInfo.coordinate.x);
        y = parseFloat(placeInfo.coordinate.y);
      }
    }

    // 메뉴 파싱
    try {
      const menuKeys = Object.keys(apolloDataHome).filter(k => k.startsWith('Menu:'));
      menuList = menuKeys.map(mKey => {
        const mInfo = apolloDataHome[mKey];
        return {
          name: mInfo.name || '',
          price: mInfo.price || '',
          description: mInfo.description || '',
          images: mInfo.images || [],
        };
      });
    } catch (err) {
      console.warn('[WARN] menu parse error:', err.message);
    }

    // ──────────────────────────────────────────
    // 2) 정보 탭 (/information) → 소개글
    // ──────────────────────────────────────────
    const infoUrl = inputUrl.replace('/home', '/information');
    await page.goto(infoUrl, { waitUntil: 'networkidle2' });

    let introduction = '';
    try {
      const introSelector = 'div.T8RFa.CEyr5';
      await page.waitForSelector(introSelector, { timeout: 3000 });
      introduction = await page.$eval(introSelector, el => el.textContent.trim());
    } catch (err) {
      console.warn('[WARN] introduction parse failed:', err.message);
    }

    // ──────────────────────────────────────────
    // 3) 리뷰 탭 (/review/ugc?type=photoView) → 블로그 리뷰 제목(최대 10개)
    // ──────────────────────────────────────────
    const reviewUrl = inputUrl.replace('/home', '/review/ugc?type=photoView');
    await page.goto(reviewUrl, { waitUntil: 'networkidle2' });

    let blogReviewTitles = [];
    try {
      const listSelector = '#app-root div.place_section_content ul > li';
      await page.waitForSelector(listSelector, { timeout: 3000 });
      blogReviewTitles = await page.$$eval(listSelector, (items) =>
        items.slice(0, 10).map(li => {
          const sel = li.querySelector('a > div.pui__dGLDWy');
          return sel ? sel.textContent.trim() : '';
        })
      );
    } catch (err) {
      console.warn('[WARN] blogReviewTitles parse failed:', err.message);
    }
    
    // ──────────────────────────────────────────
    // 결과 반환
    // ──────────────────────────────────────────
    const result = {
      placeId,
      name,
      category,
      address,
      x,
      y,
      menuList,
      introduction,
      blogReviewTitles
    };
  } catch (err) {
    console.error('[ERROR] getPlaceInfoFromUrl:', err);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { getPlaceInfoFromUrl };
// if (require.main === module) {
//   (async () => {
//     const inputUrl = process.argv[2];
//     if (!inputUrl) {
//       console.error('Usage: node placeInfoService.js "https://m.place.naver.com/..."');
//       process.exit(1);
//     }

//     console.log('[INFO] CLI Test: getPlaceInfoFromUrl:', inputUrl);

//     try {
//       const result = await getPlaceInfoFromUrl(inputUrl);
//       console.log('=== Result ===');
//       console.dir(result, { depth: null });
//     } catch (error) {
//       console.error('Error during getPlaceInfoFromUrl test:', error);
//     }
//   })();
// }