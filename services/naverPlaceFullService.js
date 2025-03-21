// services/naverPlaceFullService.js (ESM version)

import axios from "axios";
import puppeteer from "puppeteer";
import HttpsProxyAgent from "https-proxy-agent";

// (★) Import from the new crawler.js
//     loadMobileUAandCookies => load matching UA + cookies
//     PROXY_SERVER => unified proxy config
import {
  loadMobileUAandCookies,
  PROXY_SERVER
} from "../config/crawler.js";

/**
 * Decide if the URL is "mobile" or not, e.g. if it contains "m.place.naver.com"
 */
function isMobileUrl(url) {
  return url.includes("m.place.naver.com");
}
/**
 * 메인 함수
 *  1) Axios로 업체 디테일 정보 + 대표키워드 + (x, y 좌표)
 *  2) Puppeteer로 블로그리뷰 10개 + 업체소개글 + "새로오픈" 여부
 *  3) 합쳐서 반환
 */
export async function getNaverPlaceFullInfo(placeUrl) {
  // (1) Axios 파트
  const axiosResult = await getPlaceDetailWithAxios(placeUrl);
  
  // (2) Puppeteer 파트
  const puppeteerResult = await getReviewAndIntroWithPuppeteer(placeUrl);

  // (3) 합쳐서 반환
  return {
    ...axiosResult,
    blogReviewTitles: puppeteerResult.blogReviewTitles, // 최대 10개
    shopIntro: puppeteerResult.shopIntro,               // 업체 소개글
    isNewlyOpened: puppeteerResult.isNewlyOpened        // "새로오픈" 여부
  };
}

// ------------------------------------------------------------------
// (1) AXIOS로 업체 정보(디테일) + 대표키워드 + x,y 좌표 파싱
// ------------------------------------------------------------------
async function getPlaceDetailWithAxios(placeUrl) {
  try {
    // Decide if we should use mobile or PC cookies
    // (★) 5) PC vs 모바일 쿠키/UA를 랜덤 적용
    let ua, cookieStr;
    // 모바일 UA/쿠키
    ({ ua, cookieStr } = loadMobileUAandCookies());
    console.log('[INFO] 모바일 UA 선택:', ua);


    // Proxy?
    let agent = null;
    if (PROXY_SERVER && PROXY_SERVER.trim() !== "") {
      agent = new HttpsProxyAgent(PROXY_SERVER);
      console.log("[INFO] Using proxy for Axios:", PROXY_SERVER);
    }

    // Use the chosen UA + cookie
    const { data: html } = await axios.get(placeUrl, {
      headers: {
        "User-Agent": ua,
        "Cookie": cookieStr,
        // Optionally add more "natural" headers:
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      ...(agent ? { httpsAgent: agent, httpAgent: agent } : {}),
    });

    // window.__APOLLO_STATE__ 추출
    const match = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (!match) {
      console.warn("[WARN] getPlaceDetailWithAxios - __APOLLO_STATE__ not found");
      return {
        placeId: null,
        name: null,
        category: null,
        address: null,
        roadAddress: null,
        keywordList: [],
        x: null,
        y: null
      };
    }

    const jsonString = match[1];
    const apolloData = JSON.parse(jsonString);

    // 업체 정보 (placeId, name, category, address, roadAddress)
    const placeDetail = parsePlaceDetail(apolloData);

    // 대표 키워드
    const keywordList = findKeywordListDfs(apolloData);

    // x, y 좌표 (Panorama 섹션에서 lon, lat 파싱)
    const { x, y } = parseCoordinates(apolloData);

    return {
      ...placeDetail,
      keywordList,
      x,
      y
    };
  } catch (err) {
    console.error("[ERROR] getPlaceDetailWithAxios:", err.message);
    return {
      placeId: null,
      name: null,
      category: null,
      address: null,
      roadAddress: null,
      keywordList: [],
      x: null,
      y: null
    };
  }
}

// (A) 업체 디테일 파싱
function parsePlaceDetail(apolloData) {
  const possiblePrefixes = [
    "PlaceDetailBase:",
    "RestaurantDetailBase:",
    "HairshopDetailBase:",
    // 필요시 추가
  ];
  const detailKey = Object.keys(apolloData).find((k) =>
    possiblePrefixes.some((prefix) => k.startsWith(prefix))
  );
  if (!detailKey) {
    return {
      placeId: null,
      name: null,
      category: null,
      address: null,
      roadAddress: null
    };
  }

  const detailObj = apolloData[detailKey];
  return {
    placeId: detailObj.id,
    place_name: detailObj.name,
    category: detailObj.category,
    address: detailObj.address,
    roadAddress: detailObj.roadAddress
  };
}

// (B) 대표 키워드(keywordList) 파싱
function findKeywordListDfs(node) {
  if (node && typeof node === "object") {
    // 1) 현재 node에 "keywordList"가 있는지 확인
    if (Array.isArray(node.keywordList)) {
      return node.keywordList;
    }
    // 2) 없다면, node 하위 속성들 재귀 탐색
    for (const key of Object.keys(node)) {
      const child = node[key];
      const result = findKeywordListDfs(child);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

// (C) x, y 좌표 파싱 (Panorama 섹션에서 lon, lat 가져옴)
function parseCoordinates(apolloData) {
  const panoramaKey = Object.keys(apolloData).find((k) =>
    k.startsWith("Panorama:")
  );
  if (!panoramaKey) {
    return { x: null, y: null };
  }
  const panoramaData = apolloData[panoramaKey];

  const x = panoramaData.lon ? parseFloat(panoramaData.lon) : null;
  const y = panoramaData.lat ? parseFloat(panoramaData.lat) : null;

  return { x, y };
}

// ------------------------------------------------------------------
// (2) Puppeteer로 블로그리뷰 최대 10개 + 업체 소개글 + "새로오픈" 여부 파싱
// ------------------------------------------------------------------
async function getReviewAndIntroWithPuppeteer(placeUrl) {
  let browser;
  try {
    // If placeUrl includes "m.place.naver.com", use mobile cookies. Otherwise, PC
    // (★) 5) PC vs 모바일 쿠키/UA를 랜덤 적용
    let ua, cookieStr;
    // 모바일 UA/쿠키
    ({ ua, cookieStr } = loadMobileUAandCookies());
    console.log('[INFO] 모바일 UA 선택:', ua);


    // 브라우저 실행 옵션
    const launchOptions = {
      headless: "new" // Puppeteer 최신 헤드리스 모드
    };

    // 프록시 설정 (옵션)
    if (PROXY_SERVER && PROXY_SERVER.trim() !== "") {
      launchOptions.args = [`--proxy-server=${PROXY_SERVER}`];
      console.log("[INFO] Puppeteer using proxy:", PROXY_SERVER);
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // User-Agent 지정
    await page.setUserAgent(ua);
    console.log(`[INFO] Puppeteer UA => ${ua}`);

    // Convert cookieStr -> Puppeteer cookies
    const cookieArr = cookieStr.split("; ").map((pair) => {
      const [name, value] = pair.split("=");
      return {
        name,
        value,
        domain: ".naver.com", // broad domain
        path: "/"
      };
    });
    // apply them before navigation
    await page.setCookie(...cookieArr);

    //------------------------------------------------------------------
    // [A] 메인 페이지로 진입 -> 리다이렉트 후 최종 URL 확인
    //------------------------------------------------------------------
    await page.goto(placeUrl, { waitUntil: "domcontentloaded" });

    // body 로드 대기
    await page.waitForSelector("body");

    // 현재 페이지 (네이버가 리다이렉트 시킨 최종 URL)
    const finalMainUrl = page.url();
    console.log("[INFO] finalMainUrl =>", finalMainUrl);

    // "새로오픈" 요소가 있는지 확인
    const isNewlyOpened = (await page.$("span.h69bs.DjPAB")) !== null;

    //------------------------------------------------------------------
    // [B] baseUrl을 추출해서 "블로그 리뷰" 페이지 이동
    //------------------------------------------------------------------
    const baseUrl = finalMainUrl.replace(
      /\/(home|about|map|review.*|information|menu).*$/,
      ""
    );
    console.log("[INFO] baseUrl =>", baseUrl);

    // 블로그 리뷰 페이지 이동
    const reviewUrl = `${baseUrl}/review/ugc?type=photoView`;
    await page.goto(reviewUrl, { waitUntil: "domcontentloaded" });

    // 리뷰 셀렉터
    const reviewSelector = ".pui__dGLDWy";
    try {
      await page.waitForSelector(reviewSelector, { timeout: 5000 });
    } catch (e) {
      console.warn("[WARN] 블로그 리뷰 셀렉터 대기 실패:", e.message);
    }

    // 최대 10개 리뷰 제목 추출
    const reviewTitles = await page.evaluate((sel) => {
      const elements = document.querySelectorAll(sel);
      return [...elements].map((el) => el.textContent.trim());
    }, reviewSelector);
    const blogReviewTitles = reviewTitles.slice(0, 10);

    //------------------------------------------------------------------
    // [C] 업체 소개글 페이지 이동
    //------------------------------------------------------------------
    const infoUrl = `${baseUrl}/information`;
    await page.goto(infoUrl, { waitUntil: "domcontentloaded" });

    const introSelector = ".T8RFa.CEyr5, .T8RFa";
    try {
      await page.waitForSelector(introSelector, { timeout: 5000 });
    } catch (e) {
      console.warn("[WARN] 업체 소개글 셀렉터 대기 실패:", e.message);
    }

    // 업체 소개글 추출
    const shopIntro = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent.trim() : "";
    }, introSelector);

    // 결과 반환
    return {
      blogReviewTitles,
      shopIntro,
      isNewlyOpened
    };
  } catch (err) {
    console.error("[ERROR] getReviewAndIntroWithPuppeteer:", err);
    return {
      blogReviewTitles: [],
      shopIntro: "",
      isNewlyOpened: false
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ------------------------------------------------------------------
// [F] 단독 실행 시 테스트
// ------------------------------------------------------------------
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";

// ESM 전용: __filename / __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function runTest() {
  (async () => {
    // e.g. "사당맛집" or "헤어샵"
    const placeUrl = "https://m.place.naver.com/place/1282116811/home";
    console.log("[INFO] placeUrl =", placeUrl);

    // (1) 한번 raw html 받아 파일 저장 (디버그용)
    try {
      console.log("[INFO] -- (A) axios.get() 로 raw html 받아오기...");
      // Decide if mobile or pc
    // (★) 5) PC vs 모바일 쿠키/UA를 랜덤 적용
    let ua, cookieStr;
    // 모바일 UA/쿠키
    ({ ua, cookieStr } = loadMobileUAandCookies());
    console.log('[INFO] 모바일 UA 선택:', ua);


      const resp = await axios.get(placeUrl, {
        headers: {
          "User-Agent": ua,
          "Cookie": cookieStr,
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      const html = resp.data;
      fs.writeFileSync("debugPlace.html", html, "utf-8");
      console.log("[INFO] html saved to debugPlace.html");
    } catch (err) {
      console.error("[ERROR] Saving HTML:", err.message);
    }

    // (2) 이후 getNaverPlaceFullInfo 실행
    console.log("[INFO] -- (B) getNaverPlaceFullInfo...");
    const finalInfo = await getNaverPlaceFullInfo(placeUrl);
    console.log("[INFO] Result =");
    console.log(JSON.stringify(finalInfo, null, 2));
  })();
}

// node naverPlaceFullService.js
if (__filename === process.argv[1]) {
  runTest();
}