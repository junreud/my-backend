import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomDelay } from "../config/crawler.js";
/**
 * (선택 사항) 기존에 쓰시던 randomDelay 유틸이 있다면 import
 * import { randomDelay } from "./config/crawler.js";
 * 
 * 이 예시에서는 간단히 setTimeout으로 대체합니다.
 */
function randomDelay(minSec = 1, maxSec = 3) {
  const ms = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 현재 파일 경로 세팅
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// (선택) 원하는 UA 목록 - 모바일, 데스크톱 등
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.5481.100 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15A372 Safari/604.1",
];

async function getAdlogCookies(index = 1) {
  // 1) 임의의 User-Agent 선택 (또는 고정)
  const UA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  // 2) Puppeteer 브라우저 열기
  const browser = await puppeteer.launch({
    headless: false, // false → 실제 브라우저 창을 띄워서 수동 로그인
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    // defaultViewport: { width: 390, height: 844 }, // 모바일 크기로 보길 원한다면
  });

  try {
    const page = await browser.newPage();

    // (a) User-Agent 설정
    await page.setUserAgent(UA);

    // (b) HTTP 헤더(선택)
    await page.setExtraHTTPHeaders({
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    // (c) adlog.kr 로그인 페이지로 이동
    await page.goto("https://www.adlog.kr/bbs/login.php", {
      waitUntil: "domcontentloaded",
    });

    console.log("[INFO] 페이지가 열렸습니다. ID/PW를 직접 입력하고 로그인해 주세요.");

    // (d) 사용자가 직접 로그인할 시간을 주기 위해 약간 대기
    //     - 보통 로그인 버튼 클릭 시 페이지가 이동(redirect)될 것이므로 waitForNavigation()을 사용
    //     - 혹은 로그인 버튼 클릭 후 직접 기다렸다가 아래 코드가 진행되도록 할 수도 있음
    await page.waitForNavigation({ waitUntil: "networkidle0" });
    console.log("[INFO] 로그인 후 페이지 로드가 완료되었습니다.");

    // (e) 혹시 추가로 페이지 인터랙션(2차 인증 등)이 필요하다면 적절히 대기 또는 작업
    //     - 예: await randomDelay(2,5);

    // (f) 로그인 후 발급된 쿠키 수집
    const cookies = await page.cookies();
    const output = {
      userAgent: UA,
      cookies: cookies,
    };

    // (g) 파일로 저장
    const cookieFileName = `adlogCookies_${index}.json`;
    const cookiePath = path.join(__dirname, cookieFileName);
    fs.writeFileSync(cookiePath, JSON.stringify(output, null, 2), "utf-8");
    console.log(`[INFO] 로그인 후 쿠키를 저장했습니다: ${cookiePath}`);
  } catch (err) {
    console.error("[ERROR] getAdlogCookies:", err);
  } finally {
    await browser.close();
  }
}

// (★) 단독 실행 시 → 예시로 1개 쿠키 파일 생성
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    // 필요한 만큼 반복 생성이 가능
    // 여기서는 1회만 예시
    await getAdlogCookies(1);
    console.log("[INFO] Done.");
  })();
}