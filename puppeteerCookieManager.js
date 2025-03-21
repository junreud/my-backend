// puppeteerCookieManager.js

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomDelay } from "./config/crawler.js"; // 기존에 있던 randomDelay 불러오는 예시

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MOBILE_UAS = [
  // iOS Safari (iPhone 15, iOS 16)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15A372 Safari/604.1',

  // iOS Safari (iPhone 14, iOS 16)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',

  // (이하 생략: 위 목록 중 필요한 것들)
  'Mozilla/5.0 (Linux; Android 11; SAMSUNG SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.5481.100 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36',

];
/**
 * (A) Generate mobile cookies, store in mobileNaverCookies_{index}.json
 *     plus the chosen UA in the same JSON.
 * 
 * @param {string} keyword      기본 검색할 키워드 (ex: '서초맛집')
 * @param {number} index        쿠키 파일 인덱스 (1 ~ 10)
 */
export async function getMobileCookies(keyword = "서초맛집", index = 1) {
  // 가령 여러 모바일 UA 중 하나를 랜덤 선택할 수도 있음

  const MOBILE_UA = MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];

  // Puppeteer config
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',  // 혹은 필요에 따라
    ],
    defaultViewport: { width: 390, height: 844 }, // iPhone-ish
  });

  try {
    const page = await browser.newPage();
    
    // (1) Set the mobile UA
    await page.setUserAgent(MOBILE_UA);

    // (2) Set extra HTTP headers
    await page.setExtraHTTPHeaders({
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",

    });

    // (3) Go to m.naver.com
    await page.goto("https://m.naver.com", { waitUntil: "domcontentloaded" });

    // (4) Perform search
    await randomDelay(1, 3);
    await page.click("#MM_SEARCH_FAKE");
    await page.waitForSelector("#query");
    await page.type("#query", keyword, { delay: 100 });
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });

    // (5) 펼쳐서 더보기
    try {
      // 검색 결과 페이지로 넘어온 직후
      await randomDelay(3, 5);

      // 4) 그리고 나서 span.PNozS 찾기
      await page.waitForSelector("span.PNozS", { timeout: 10000 });
      await randomDelay(1, 2);
      await page.evaluate(() => {
        document.querySelector('span.PNozS')?.click();
      });      
    } catch (e) {
      console.warn("[WARN] '펼쳐서 더보기' not found:", e.message);
    }

    // (6) 예시로 첫 번째 추천 키워드 클릭
    try {
      // a.cf8PL 안에 span.UPDKY가 있음
      await page.waitForSelector("a.cf8PL span.UPDKY", { timeout: 10000 });
    
      // 'a.cf8PL' 요소들을 수집 (필요하다면 1개만 가져와도 무방)
      const recommendedLinks = await page.$$("a.cf8PL");    
      if (recommendedLinks.length > 0) {
        // 첫 번째 추천 링크 클릭
        await recommendedLinks[0].click();
        await randomDelay(1, 4);
      } else {
        console.warn("[WARN] '추천 키워드 링크(a.cf8PL)' not found");
      }
    
    } catch (e) {
      console.warn("[WARN] '추천 키워드' wait fail:", e.message);
    }

    // (7) Collect cookies
    const cookies = await page.cookies();
    const output = {
      ua: MOBILE_UA,    // store the UA used
      cookies,          // array of cookie objects
    };

    // (★) 인덱스 기반으로 파일명 생성
    const cookiePath = path.join(__dirname, `mobileNaverCookies_${index}.json`);
    fs.writeFileSync(cookiePath, JSON.stringify(output, null, 2), "utf-8");

    console.log(`[INFO] Mobile cookies + UA saved to ${cookiePath}`);
  } catch (err) {
    console.error("[ERROR] getMobileCookies:", err);
  } finally {
    await browser.close();
  }
}


// (★) 명령줄 실행 시 → 10개 쿠키파일 병렬 생성
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    // 1 ~ 10까지 쿠키 생성
    const tasks = [];
    for (let i = 1; i <= 10; i++) {
      tasks.push(getMobileCookies("서초맛집", i));
      randomDelay(2,4);
    }

    // 병렬 실행
    await Promise.all(tasks);
    console.log("[INFO] Done generating 10 mobile cookie files.");
  })();
}