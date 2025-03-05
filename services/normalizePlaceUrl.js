// services/normalizePlaceUrl.js (ESM 버전)
import puppeteer from 'puppeteer';

/**
 * 짧은 URL(naver.me)을 해제하여 최종 URL을 반환하는 함수
 * @param {string} url - 입력 URL
 * @returns {Promise<string>} - 해제된 URL
 */
async function resolveShortUrl(url) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    return page.url();
  } catch (err) {
    console.error('[ERROR] resolveShortUrl:', err);
    return url;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * 입력 URL을 정규화하여 "https://m.place.naver.com/place/{placeId}/home" 형태의 URL로 변환
 * @param {string} inputUrl - 축소형, PC형, Mobile형 URL 등
 * @returns {Promise<string|null>} - 정규화된 URL 또는 null (실패 시)
 */
export async function normalizePlaceUrl(inputUrl) {
  let resolvedUrl = inputUrl;
  // 축소형 URL 여부 확인 
  if (inputUrl.includes('naver.me/')) {
    console.log('[INFO] 축소형 URL 감지. 해제 중...');
    resolvedUrl = await resolveShortUrl(inputUrl);
    console.log('[INFO] 해제된 URL:', resolvedUrl);
  }
  
  // "place/{placeId}" 또는 "place/{placeId}?placePath" 형태의 플레이스 ID 추출
  const match = resolvedUrl.match(/(?:place\/|\/)(\d+)(?:\/|$|\?)/);
  if (!match) {
    console.error('[ERROR] URL에서 Place ID를 추출하지 못했습니다.');
    return null;
  }
  const placeId = match[1];
  const normalizedUrl = `https://m.place.naver.com/place/${placeId}/home`;
  console.log('[INFO] 정규화된 URL:', normalizedUrl);
  return normalizedUrl;
}