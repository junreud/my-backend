import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";

// (1) 'checkIsRestaurantByDOM' 함수는 질문에 주신 isRestaurantChecker.js 예시라고 가정.
import { checkIsRestaurantByDOM } from "../services/isRestaurantChecker.js";

// (2) DB 모델 (keywords 테이블)
import Keyword from "../models/Keyword.js";  // 예: Sequelize 모델 가정

// (3) 유틸 (로그, 딜레이 등)
import { createLogger } from "../lib/logger.js";
const logger = createLogger("adlogHiddenKeywordScraper");

// (선택) randomDelay
function randomDelay(minSec, maxSec) {
  const ms = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 예시: placedetailresults에서 추출했다고 가정하는 placeId 목록
 * 실제로는 외부 JSON, DB, 또는 다른 로직으로부터 placeIds를 가져오시면 됩니다.
 */
const placeIds = [
  "15135772",  // 예: 강촌막국수 placeId
  "11693890",  // 예: 다른 업체 placeId
  // ...
];

/**
 * main 함수
 * - adlog.kr 로그인 → "플레이스 히든 키워드" 페이지 → placeIds 각각 조회 → hidden_keyword 추출
 * - 추출된 키워드를 DB 저장 (is_restaurant 여부는 checkIsRestaurantByDOM()으로 판별)
 */
async function scrapeHiddenKeywords(placeIds) {
  let browser;
  try {
    // (A) 브라우저 열기 (headless: false → 수동 로그인)
    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: { width: 1200, height: 800 },
    });
    const page = await browser.newPage();

    // (B) adlog.kr 로그인 페이지로 이동
    await page.goto("https://www.adlog.kr/bbs/login.php", {
      waitUntil: "domcontentloaded",
    });
    logger.info("[INFO] adlog.kr 로그인 페이지 접속 완료. 직접 로그인 해주세요.");

    // (★) 사용자가 직접 ID/PW 입력 후, 로그인 버튼 클릭 → 로그인 완료 시 다음 페이지로 이동
    //     로그인 성공 후, 페이지 이동(redirect) / 또는 새로고침이 일어날 것
    await page.waitForNavigation({ waitUntil: "networkidle0" });
    logger.info("[INFO] 로그인 성공, 메인 페이지 로드 완료.");

    // (C) "플레이스 히든 키워드" 메뉴 클릭
    //     링크 텍스트가 "./naver_place_hidden_keyword.php" 이므로 a[href*="naver_place_hidden_keyword"] 등으로 찾을 수 있음
    const selectorHiddenKeywordLink = 'a[href="./naver_place_hidden_keyword.php"]';
    await page.waitForSelector(selectorHiddenKeywordLink);
    await page.click(selectorHiddenKeywordLink);
    logger.info("[INFO] '플레이스 히든 키워드' 페이지로 이동 중...");
    randomDelay(1, 2); 

    // (D) placeIds 순회
    for (const placeId of placeIds) {
      // 1) URL 형태로 만들어서 인풋에 입력 (예: 'https://m.place.naver.com/restaurant/15135772')
      const placeURL = `https://m.place.naver.com/restaurant/${placeId}`;
      // ※ 업체 타입이 식당이 아닐 수도 있으니, 실제 URL 스키마는 상황에 맞게 결정해주세요.

      logger.info(`[INFO] 현재 placeId="${placeId}" → placeURL="${placeURL}" 조회 시도`);
      // (i) 인풋(#keyword2) 초기화 & 입력
      await page.waitForSelector("#keyword2");
      await page.evaluate(() => {
        document.querySelector("#keyword2").value = "";      });
      await page.type("#keyword2", placeURL, { delay: 50 });

      // (ii) [조회] 버튼 클릭
      const btnSelector = "button.tool_sch_submit[type='submit']";
      await page.waitForSelector(btnSelector);
      await page.click(btnSelector);

      // (iii) 조회 결과 기다리기
      //       만약 페이지 리로드가 없다면, DOM 변화를 기다려야 할 수도 있음
      await randomDelay(1, 3);

      // (E) <div class="hidden_keyword"> 내부의 키워드 추출
      //     예: div.hidden_keyword > div.layer-detail-btn.curp
      //     data-keyword 어트리뷰트로부터 실제 키워드 추출
      const hiddenKeywordSelector = "div.hidden_keyword > div.layer-detail-btn.curp";
      await page.waitForSelector(hiddenKeywordSelector, { timeout: 10000 });

      // (iv) .layer-detail-btn.curp 들의 data-keyword 수집
      const keywords = await page.$$eval(hiddenKeywordSelector, (nodes) =>
        nodes.map((el) => el.getAttribute("data-keyword"))
      );

      logger.info(`[INFO] placeId="${placeId}" → 추출된 키워드:`, keywords);

      // (F) 각 키워드를 DB에 저장
      for (const kw of keywords) {
        if (!kw) continue;

        // ① DB에 존재하는지 확인
        let record = await Keyword.findOne({ where: { keyword: kw } });
        if (record) {
          logger.info(`[SKIP] 이미 등록된 키워드="${kw}", is_restaurant=${record.is_restaurant}`);
          continue;
        }

        // ② 존재하지 않으면 is_restaurant 판별
        const isRestaurantVal = await checkIsRestaurantByDOM(kw);
        // (또는 간단히: const isRestaurantVal = await isRestaurant(kw) 형태로 직접 만든 함수 호출)

        // ③ keywords 테이블에 INSERT
        record = await Keyword.create({
          keyword: kw,
          is_restaurant: isRestaurantVal,
        });
        logger.info(`[INSERT] keyword="${kw}", is_restaurant=${isRestaurantVal}`);
      }

      // (★) placeId 하나 처리 후 잠시 대기
      await randomDelay(1, 2);
    }

    logger.info("[DONE] 모든 placeId 처리 완료.");

  } catch (error) {
    logger.error(`[ERROR] scrapeHiddenKeywords: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 스크립트 단독 실행 시
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    await scrapeHiddenKeywords(placeIds);
    logger.info("[INFO] Done.");
  })();
}