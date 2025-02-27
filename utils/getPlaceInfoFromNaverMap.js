/**
 * getPlaceInfoFromNaverMap.js
 * Puppeteer를 이용해 네이버 플레이스 URL의 업체 정보를 크롤링하는 예시
 */

import puppeteer from 'puppeteer';
// 네이버 플레이스 페이지가 완전히 로드되는 시간을 기다리기 위한 sleep 함수
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 실제로는 DOM 구조를 직접 확인해 셀렉터를 찾아야 합니다.
 * 네이버 플레이스는 동적 렌더링 + 자주 변경될 수 있으므로, 
 * 아래 셀렉터 예시는 반드시 테스트 & 수정이 필요합니다.
 */
async function getPlaceInfoFromNaverMap(url) {
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // 네이버 지도/플레이스 페이지로 이동
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    
    // 페이지가 완전히 렌더링될 때까지 잠시 대기 (또는 특정 셀렉터 대기)
    await sleep(2000);

    // 예: 플레이스 상세에서 업체명을 표시하는 셀렉터(가상의 예시)
    // 실제로 DevTools 열어서 클래스명/태그를 확인한 뒤 수정 필요
    const nameSelector = '.place_section_content h2';
    const addressSelector = '.place_section_content ._3NUK2';
    const categorySelector = '.place_section_content ._3ocDE';
    const latDataSelector = 'meta[name="twitter:latitude"]';  // meta 태그에 lat/lng가 담겨있을 수도 있음
    const lngDataSelector = 'meta[name="twitter:longitude"]';

    // 업체명
    const placeName = await page.$eval(nameSelector, el => el.textContent.trim())
      .catch(() => ''); // 셀렉터 없을 시 에러 → 빈 문자열로 처리

    // 주소
    const address = await page.$eval(addressSelector, el => el.textContent.trim())
      .catch(() => '');

    // 업종/카테고리
    const category = await page.$eval(categorySelector, el => el.textContent.trim())
      .catch(() => '');

    // 좌표 (meta 태그나 script 내 JSON 파싱 등 필요할 수 있음)
    let lat = 0;
    let lng = 0;
    try {
      const latContent = await page.$eval(latDataSelector, el => el.getAttribute('content'));
      const lngContent = await page.$eval(lngDataSelector, el => el.getAttribute('content'));
      lat = parseFloat(latContent) || 0;
      lng = parseFloat(lngContent) || 0;
    } catch (e) {
      // 좌표 태그가 없을 경우
      console.warn('위도/경도 메타태그를 찾지 못함. 필요 시 다른 방법으로 파싱');
    }

    // 메뉴 정보나 세부 정보는 추가 셀렉터/클릭이 필요할 수 있음
    // 간단 예시로 mainMenuKeywords를 빈 배열로 처리
    const mainMenuKeywords = [];

    // placeId 추출 (URL 파라미터나 HTML 내 JSON 스크립트에서 찾는 식)
    let placeId = '';
    try {
      // URL에서 placeId가 있는지 정규식으로 뽑기
      // 예: https://map.naver.com/v5/entry/place/1114530602?c=...
      const match = url.match(/place\/(\d+)/);
      if (match && match[1]) {
        placeId = match[1];
      }
    } catch (e) {
      console.warn('placeId 추출 실패');
    }

    // JSON 형태로 리턴
    return {
      placeId,
      name: placeName,
      address,
      category,
      x: lng,
      y: lat,
      mainMenuKeywords
    };

  } catch (err) {
    console.error('getPlaceInfoFromNaverMap Error:', err);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  getPlaceInfoFromNaverMap
};
