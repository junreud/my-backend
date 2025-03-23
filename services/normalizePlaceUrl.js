// services/normalizePlaceUrl.js
import puppeteer from 'puppeteer';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('NormalizePlaceUrl');

/**
 * 축소형 URL(naver.me)을 해제하여 최종 URL을 반환
 * @param {string} url
 */
async function resolveShortUrl(url) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    return page.url();
  } catch (err) {
    logger.error('[ERROR] resolveShortUrl:', err);
    return url;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * 정규화한 URL로 접근 후, DOM 안에 있는 <a href="/restaurant/1602026142/home"> 등
 * 실제 카테고리(restaurant, cafe, etc)가 들어간 href 속성을 추출하여
 * "https://m.place.naver.com/restaurant/1602026142/home" 형태를 최종 반환
 *
 * @param {string} normalizedUrl "https://m.place.naver.com/place/{placeId}/home"
 * @returns {Promise<string>} 최종 URL
 */
async function getUrlFromAnchor(normalizedUrl) {
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();

    // 모바일 User-Agent 설정 (중요)
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
    );

    // 정규화된 URL로 접속
    await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded' });

    // 네이버 플레이스 홈 탭 A 태그가 나타날 때까지 대기
    // (홈 탭은 "/{카테고리}/{placeId}/home" 형태이므로 그걸 노린다)
    // 검색 범위 예시: <a href="/restaurant/1602026142/home" ...>홈</a>
    const selector = 'a[href*="/home"]'; // "/home"을 포함하는 모든 a
    await page.waitForSelector(selector, { timeout: 5000 });

    // 여러 개가 있을 수 있으니, '홈' 탭을 찾기 위해 텍스트가 '홈'인 요소를 찾거나,
    // aria-selected="true"인 탭을 찾는 식으로 구체화할 수도 있음
    // 여기서는 일단 첫 번째 "/home" 포함 a 태그의 href를 쓰는 예시

    const finalHref = await page.evaluate((sel) => {
      const aTags = document.querySelectorAll(sel);
      // a[href*="/home"] 태그들 중 "홈" 탭일 것으로 보이는 첫 번째
      if (!aTags.length) return null;
      return aTags[0].getAttribute('href');
    }, selector);

    if (!finalHref) {
      // 만약 못 찾았다면 그냥 현재 page.url() 반환
      logger.warn('[WARN] 홈 탭 A 태그를 찾지 못했습니다. 현재 URL 반환.');
      return page.url();
    }

    // href가 "/restaurant/123456789/home"처럼 절대경로(도메인 제외)라면,
    // https://m.place.naver.com/ 를 앞에 붙여서 반환
    if (finalHref.startsWith('/')) {
      return 'https://m.place.naver.com' + finalHref;
    }

    // 혹시 href가 절대 URL이면 그대로 반환
    return finalHref;
  } catch (err) {
    logger.error('[ERROR] getUrlFromAnchor:', err);
    return normalizedUrl;
  } finally {
    await browser.close();
  }
}

/**
 * "입력 URL" → (1) 축소형이라면 resolveShortUrl로 풀고
 *           → (2) placeId 추출
 *           → (3) "https://m.place.naver.com/place/{placeId}/home" 형태로 정규화
 *           → (4) 실제 페이지의 <a href="/restaurant/.../home"> 로부터 최종 URL 추출
 *
 * @param {string} inputUrl
 * @returns {Promise<string|null>}
 */
export async function normalizePlaceUrl(inputUrl) {
  let resolvedUrl = inputUrl;

  // 1) 축소형 URL(navere.me/...)이면 풀기
  if (resolvedUrl.includes('naver.me/')) {
    resolvedUrl = await resolveShortUrl(resolvedUrl);
  }

  // 2) placeId 추출
  //    예: /place/12345678/, /restaurant/12345678/, /cafe/12345678/ ...
  const match = resolvedUrl.match(/(?:place\/|restaurant\/|cafe\/|\/)(\d+)(?:\/|$|\?)/);
  if (!match) {
    logger.error('[ERROR] URL에서 place ID 추출 실패:', resolvedUrl);
    return null;
  }
  const placeId = match[1];

  // 3) 정규화 URL
  const normalizedUrl = `https://m.place.naver.com/place/${placeId}/home`;

  // 4) 실제 DOM의 <a href="/restaurant/{placeId}/home">를 추출
  const finalUrl = await getUrlFromAnchor(normalizedUrl);
  logger.info('[INFO] 최종 URL:', finalUrl);

  return finalUrl;
}
