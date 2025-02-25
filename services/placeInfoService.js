const puppeteer = require('puppeteer');

async function getPlaceInfoFromUrl(url) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // networkidle2 옵션으로 페이지 로딩이 충분히 끝날 때까지 기다림
    await page.goto(url, { waitUntil: 'networkidle2' });

    // 특정 요소가 나타날 때까지 기다리기 (예: 업체명 요소, 실제 페이지의 셀렉터로 수정)
    await page.waitForSelector('h1'); // 실제 업체명이 들어있는 셀렉터 사용
    await page.waitForFunction('window.__APOLLO_STATE__ || undifined', { timeout: 5000 });
    // __APOLLO_STATE__ 추출
    const apolloData = await page.evaluate(() => window.__APOLLO_STATE__ || null);
    console.log(window.__APOLLO_STATE__);
    
    if (!apolloData) {
      console.warn('[WARN] __APOLLO_STATE__가 없습니다. 페이지 구조가 변경되었거나 올바른 URL이 아닐 수 있습니다.');
      return null;
    }

    const placeKey = Object.keys(apolloData).find(k => k.startsWith('PlaceDetailBase:'));
    if (!placeKey) {
      console.warn('[WARN] PlaceDetailBase 키를 찾지 못했습니다.');
      return null;
    }

    const placeDetail = apolloData[placeKey];
    if (!placeDetail) {
      console.warn('[WARN] placeDetail 객체가 비어있습니다.');
      return null;
    }

    const placeId = placeDetail.id || '';
    const name = placeDetail.name || '';
    const category = placeDetail.category || '';
    const address = placeDetail.roadAddress || placeDetail.address || '';
    
    let x = 0, y = 0;
    if (placeDetail.coordinate && placeDetail.coordinate.x && placeDetail.coordinate.y) {
      x = parseFloat(placeDetail.coordinate.x);
      y = parseFloat(placeDetail.coordinate.y);
    }

    const result = { placeId, name, category, address, x, y };
    console.log('[INFO] 파싱 결과:', result);
    return result;

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
