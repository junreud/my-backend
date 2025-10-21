// isRestaurantChecker.js
import path from "path";
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { createLogger } from '../lib/logger.js';

// (★) crawler.js에서 필요한 함수, UA+쿠키 로드, randomDelay 등 가져오기
import {
  loadMobileUAandCookies,
  randomDelay
} from "../config/crawler.js";

// DB 모델 (Keyword) 임포트
import Keyword from "../models/Keyword.js";

const logger = createLogger('RestaurantChecker');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 키워드를 받아서 간소화된 방법으로 restaurant 여부를 판별합니다
 * 1) 네이버 모바일 페이지에서 해당 키워드를 검색
 * 2) "조건에 맞는 업체가 없습니다" 텍스트 확인
 * 3) 모든 링크를 분석하여 restaurant 관련 링크 존재 여부 확인
 * 4) Keyword 테이블에 결과 저장
 */
export async function checkIsRestaurantByDOM(keyword) {
  // (A) 이미 Keyword 테이블에 해당 키워드가 있는지 확인
  let record = await Keyword.findOne({ where: { keyword } });
  if (record) {
    logger.info(`[INFO] 이미 DB에 존재하는 키워드="${keyword}", isRestaurant=${record.isRestaurant}`);
    return record.isRestaurant ? 1 : 0; 
  }

  // (B) 만약 DB에 없으면 → Playwright로 검색 후 링크 분석
  let browser;
  let isRestaurantVal = 0; // 기본값 0(일반키워드)
  let hasNoResults = false; // "조건에 맞는 업체가 없습니다" 텍스트 확인 플래그
  
  try {
    logger.info(`[INFO] checkIsRestaurantByDOM: 키워드="${keyword}" DB에 없으므로 직접 판별`);

    // (1) Playwright UA+쿠키
    const { ua, cookieStr } = loadMobileUAandCookies();
    logger.debug(`[DEBUG] UA=${ua}`);

    // Playwright으로 브라우저 실행 - headless 옵션을 true로 변경
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 390, height: 844 }
    });
    const cookieArr = cookieStr.split("; ").map((pair) => {
      const [name, value] = pair.split("=");
      return {
        name,
        value,
        domain: ".naver.com",
        path: "/",
      };
    });
    await context.addCookies(cookieArr);
    const page = await context.newPage();

    await page.setExtraHTTPHeaders({
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    });

    // (2) m.naver.com 접속
    await page.goto("https://m.naver.com", { waitUntil: "domcontentloaded" });

    // (3) 검색창 열고 입력
    await page.click("#MM_SEARCH_FAKE");
    await page.waitForSelector("#query");
    await page.type("#query", keyword, { delay: 100 });
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
    
    // 디버깅을 위해 스크린샷 저장
    await page.screenshot({ path: path.join(__dirname, `../screenshots/${keyword}-search.png`) });

    // (4) "조건에 맞는 업체가 없습니다" 텍스트 확인 - 새로 추가된 부분
    hasNoResults = await page.evaluate(() => {
      const pageText = document.body.innerText;
      return pageText.includes('조건에 맞는 업체가 없습니다');
    });
    
    if (hasNoResults) {
      logger.info("[INFO] '조건에 맞는 업체가 없습니다' 메시지 발견");
      // 결과 없음 표시를 위해 상태 저장하고 계속 진행
    }

    // (5) 전체 페이지에서 모든 링크를 검사 (DOM 기반 탐지 제거, 링크 분석만 수행)
    const placeItems = await page.$$eval("a", (links) =>
      links.map((a) => a.getAttribute("href") || "")
    );
    
    // 디버깅
    logger.info(`[INFO] 찾은 링크: ${JSON.stringify(placeItems.slice(0, 5))}...`);
    
    // 결과 분석: restaurant, cafe 또는 place 링크가 있는지 확인
    const restaurantKeywords = ['/restaurant/', 'restaurant', '맛집', '식당', '레스토랑'];
    const foundRestaurantLink = placeItems.some(href => 
      restaurantKeywords.some(keyword => href.includes(keyword))
    );
    
    if (foundRestaurantLink) {
      isRestaurantVal = 1;
      logger.info("[INFO] 맛집/음식점 관련 링크 발견!");
    } else {
      logger.info("[INFO] 맛집/음식점 관련 링크 없음");
    }

    // 최종 결과 스크린샷
    await page.screenshot({ path: path.join(__dirname, `../screenshots/${keyword}-final.png`) });
    logger.info(`[INFO] 파악 결과: isRestaurantVal=${isRestaurantVal}`);

    // (C) DB에 해당 키워드 저장 (새 레코드)
    record = await Keyword.create({
      keyword,
      isRestaurant: isRestaurantVal,
      // "조건에 맞는 업체가 없습니다" 메시지가 있으면 has_no_results 필드를 true로 설정
      // 이 필드가 Keyword 모델에 없을 경우 추가해야 함
      has_no_results: hasNoResults
    });
    logger.info(`[INFO] 새 키워드 저장됨: keyword=${keyword}, isRestaurant=${isRestaurantVal}, has_no_results=${hasNoResults}`);
  } catch (err) {
    logger.error(`[ERROR] checkIsRestaurantByDOM: ${err}`);
  } finally {
    if (browser) await browser.close();
  }

  return isRestaurantVal;
}