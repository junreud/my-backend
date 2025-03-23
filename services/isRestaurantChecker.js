// isRestaurantChecker.js

import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
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
 * 키워드를 받아서,
 * 1) 네이버 모바일 페이지에서 해당 키워드를 검색
 * 2) "펼쳐서 더보기" + "span.UPDKY" 클릭 (질문에서 주신 로직)
 * 3) 목록 li.UEzoS 검사 → 만약 `<a href="/restaurant/...">` 가 하나라도 발견되면 레스토랑(true=1), 아니면 false=0
 * 4) Keyword 테이블에서 해당 키워드가 없으면 (dbRecord==null) → 새로 저장
 * 5) 값이 있으면 업데이트(혹은 그대로) 해도 되고, 원하는대로 처리
 */
export async function checkIsRestaurantByDOM(keyword) {
  // (A) 이미 Keyword 테이블에 해당 키워드가 있는지 확인
  let record = await Keyword.findOne({ where: { keyword } });
  if (record) {
    logger.info(`[INFO] 이미 DB에 존재하는 키워드="${keyword}", isRestaurant=${record.isRestaurant}`);
    return record.isRestaurant ? 1 : 0; 
  }

  // (B) 만약 DB에 없으면 → Puppeteer로 검색 후 DOM 분석
  let browser;
  let isRestaurantVal = 0; // 기본값 0(일반키워드)
  try {
    logger.info(`[INFO] checkIsRestaurantByDOM: 키워드="${keyword}" DB에 없으므로 직접 판별`);

    // (1) Puppeteer UA+쿠키
    const { ua, cookieStr } = loadMobileUAandCookies();
    logger.debug(`[DEBUG] UA=${ua}`);

    browser = await puppeteer.launch({
      headless: 'new',
      defaultViewport: { width: 390, height: 844 },
    });

    const page = await browser.newPage();
    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    });

    // (★) 쿠키 적용
    const cookieArr = cookieStr.split("; ").map((pair) => {
      const [name, value] = pair.split("=");
      return {
        name,
        value,
        domain: ".naver.com",
        path: "/",
      };
    });
    await page.setCookie(...cookieArr);

    // (2) m.naver.com 접속
    await page.goto("https://m.naver.com", { waitUntil: "domcontentloaded" });

    // (3) 검색창 열고 입력
    await page.click("#MM_SEARCH_FAKE");
    await page.waitForSelector("#query");
    await page.type("#query", keyword, { delay: 100 });
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });

    // (4) "펼쳐서 더보기" 클릭
    try {
      await page.waitForSelector("span.PNozS", { timeout: 100000 });
      await randomDelay(3, 4);
      await page.click("span.PNozS");
      await randomDelay(1, 4);
    } catch (e) {
      logger.warn("[WARN] '펼쳐서 더보기' not found:", e.message);
    }

    // (5) "사당맛집"등의 span.UPDKY 클릭
    try {
      await page.waitForSelector("span.UPDKY", { timeout: 10000 });
      const elements = await page.$$("span.UPDKY");
      if (elements.length > 0) {
        await elements[0].click();
        await randomDelay(1, 4);
      } else {
        logger.warn("[WARN] span.UPDKY not found");
      }
    } catch (e) {
      logger.warn("[WARN] span.UPDKY wait fail:", e.message);
    }

    // (6) 목록 li.UEzoS 검사
    //     만약 <a href="/restaurant/..."> 라우트를 하나라도 발견하면 => 레스토랑
    try {
      await page.waitForSelector("li.UEzoS", { timeout: 10000 });
      const placeItems = await page.$$eval("li.UEzoS a", (links) =>
        links.map((a) => a.getAttribute("href") || "")
      );
      // placeItems = ["/restaurant/12345?entry=pll", "/place/9999?entry=pll", ...]
      const foundRestaurantLink = placeItems.some((href) => href.includes("/restaurant/"));
      if (foundRestaurantLink) {
        isRestaurantVal = 1;
      }
    } catch (err) {
      logger.warn(`[WARN] li.UEzoS not found or no items: ${err.message}`);
    }

    logger.info(`[INFO] 파악 결과: isRestaurantVal=${isRestaurantVal}`);

    // (C) DB에 해당 키워드 저장 (새 레코드)
    record = await Keyword.create({
      keyword,
      isRestaurant: isRestaurantVal,
    });
    logger.info(`[INFO] 새 키워드 저장됨: keyword=${keyword}, isRestaurant=${isRestaurantVal}`);
  } catch (err) {
    logger.error(`[ERROR] checkIsRestaurantByDOM: ${err}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return isRestaurantVal;
}