/******************************************************
 * keywordGrounpingService.js
 *  - Puppeteer로 모바일(또는 PC) 네이버 페이지를 직접 열어 크롤링
 *  - axios + cheerio로 HTML만 받아 파싱
 *  - 공통 설정/함수는 crawler.js에서 import
 ******************************************************/

import puppeteer from "puppeteer";
import axios from "axios";
import * as cheerio from "cheerio";

// (★) crawler.js에서 가져오는 부분
import {
  loadMobileUAandCookies,
  loadPcUAandCookies,
  getRandomCoords,
  randomDelay
} from "../config/crawler.js";

/**
 * “모바일 모드”로 할지 “PC 모드”로 할지 선택하는 헬퍼
 */
function wantMobile() {
  // 여기서는 임의로 true(모바일)로 가정
  // 필요하면 인자나 환경변수를 써서 결정
  return true;
}

/**
 * (A) Puppeteer: 네이버에서 키워드 검색 → 상위 10개 업체명 추출
 *     (모바일 or PC를 cookie + UA로 일치)
 */
async function crawlTop10NaverResults(page, keyword) {
  // 1) 무작위 좌표
  const baseX = 126.977;
  const baseY = 37.5665;
  const { randX, randY } = getRandomCoords(baseX, baseY, 300);

  // 2) 네이버 검색 URL (모바일이면 m.place, PC면 똑같이 m.place를 써도 되나, 
  //    여기서는 모바일 구조를 주로 쓰는 예시)
  const url = `https://m.place.naver.com/place/list?query=${encodeURIComponent(
    keyword
  )}&x=${randX}&y=${randY}&level=top&entry=pll`;
  console.log(`>>> [${keyword}] final search URL:`, url);

  // 3) 페이지 이동
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // 4) 특정 셀렉터 대기
  try {
    await page.waitForSelector("h1#_header.bh9OH", { timeout: 8000 });
  } catch {
    console.log(`[WARN] 셀렉터를 찾지 못했습니다. keyword=${keyword}`);
  }

  // 5) 모든 업체 목록 li.VLTHu
  const allItems = await page.$$("li.VLTHu");

  // (6) 광고 제외 (data-laim-exp-id !== 'undefined')
  const realItems = [];
  for (const li of allItems) {
    const laimExpId = await li.evaluate((el) =>
      el.getAttribute("data-laim-exp-id")
    );
    if (laimExpId === "undefined") {
      realItems.push(li);
    }
  }

  // 최대 10개만
  const topItems = realItems.slice(0, 10);

  // (7) 각 아이템에서 업체명 추출 (.YwYLL)
  const top10Names = [];
  for (const item of topItems) {
    const name = await item.$eval(".YwYLL", (el) => el.textContent.trim());
    top10Names.push(name);
  }

  return top10Names;
}

/**
 * (B) axios + cheerio: 네이버 HTML GET → 상위 10개 업체명
 *     (여기도 모바일 or PC UA + 쿠키를 일치시키려면, load...() 사용)
 */
async function fetchNaverTop10HTML(keyword, randX, randY) {
  // URL은 모바일 구조 예시
  const url = `https://m.place.naver.com/place/list?query=${encodeURIComponent(
    keyword
  )}&x=${randX}&y=${randY}&level=top&entry=pll`;

  // (★) PC or Mobile 결정
  let ua, cookieStr;
  if (wantMobile()) {
    ({ ua, cookieStr } = loadMobileUAandCookies());
    console.log("[DEBUG] fetchNaverTop10HTML (Mobile Mode), UA=", ua);
  } else {
    ({ ua, cookieStr } = loadPcUAandCookies());
    console.log("[DEBUG] fetchNaverTop10HTML (PC Mode), UA=", ua);
  }

  // (★) axios 요청 헤더
  const headers = {
    "User-Agent": ua,
    Cookie: cookieStr,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const resp = await axios.get(url, { headers });
  return resp.data;
}

/**
 * (C) 단순 파싱: HTML에서 li.VLTHu 광고 제외 상위 10개 추출
 */
function parseNaverTop10(html) {
  const $ = cheerio.load(html);
  const allItems = $("li.VLTHu");
  const realItems = allItems.filter(
    (i, el) => $(el).attr("data-laim-exp-id") === "undefined"
  );

  const top10Names = [];
  realItems.slice(0, 10).each((i, el) => {
    const name = $(el).find(".YwYLL").text().trim();
    top10Names.push(name);
  });
  return top10Names;
}

/**
 * (D) 동일한 Top10 결과를 그룹화
 */
function groupByTop10(list) {
  const map = new Map();

  list.forEach((item) => {
    const signature = item.top10.join("|");
    if (!map.has(signature)) {
      map.set(signature, {
        top10: item.top10,
        items: [],
      });
    }
    map.get(signature).items.push({
      rank: item.rank,
      keyword: item.keyword,
      monthlySearchVolume: item.monthlySearchVolume,
    });
  });

  return Array.from(map.values());
}

/**
 * (E) Puppeteer 방식으로 키워드 목록을 처리:
 *     - 새 브라우저 열고, 각 키워드마다 UA+쿠키 적용
 *       (다만 여기서는 모바일/PC 구분은 "wantMobile()" 한 번만 결정)
 */
export async function groupKeywordsByNaverTop10(keywordList) {
  // PC or Mobile 결정
  let ua, cookieStr;
  if (wantMobile()) {
    ({ ua, cookieStr } = loadMobileUAandCookies());
    console.log("[INFO] groupKeywordsByNaverTop10: Mobile Mode");
  } else {
    ({ ua, cookieStr } = loadPcUAandCookies());
    console.log("[INFO] groupKeywordsByNaverTop10: PC Mode");
  }

  const browser = await puppeteer.launch({ headless: "new" });
  const results = [];

  try {
    for (const item of keywordList) {
      const { rank, keyword, monthlySearchVolume } = item;

      const page = await browser.newPage();

      // (★) UA 설정
      await page.setUserAgent(ua);
      console.log(`[DEBUG] Puppeteer setUserAgent = ${ua}`);

      // (★) 쿠키 배열화
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

      // 실제 크롤링
      const top10 = await crawlTop10NaverResults(page, keyword);
      results.push({ rank, keyword, monthlySearchVolume, top10 });

      await page.close();

      // 차단 방지 간단 딜레이
      await randomDelay(1, 3);
    }

    const grouped = groupByTop10(results);
    return grouped.map((group) => {
      const combinedKeyword = group.items.map((i) => i.keyword).join(", ");
      const details = group.items.map((i) => ({
        rank: i.rank,
        monthlySearchVolume: i.monthlySearchVolume,
      }));
      return { combinedKeyword, details };
    });
  } catch (err) {
    console.error("[ERROR] groupKeywordsByNaverTop10:", err);
    return [];
  } finally {
    await browser.close();
  }
}

/**
 * (F) axios + cheerio 버전
 */
export async function groupKeywordsByHttpFetch(keywordList) {
  let index = 0;
  const results = [];

  while (index < keywordList.length) {
    // 묶음 크기 5~12
    const batchSize = Math.floor(Math.random() * 8) + 5;
    const slice = keywordList.slice(index, index + batchSize);

    console.log(
      `[DEBUG] keyword batch size=${batchSize}, index=${index}..${
        index + batchSize - 1
      }`
    );

    const promises = slice.map(async (item) => {
      const { rank, keyword, monthlySearchVolume } = item;
      try {
        // 무작위 좌표
        const { randX, randY } = getRandomCoords(126.977, 37.5665, 300);

        // (★) fetch HTML (UA+쿠키는 fetchNaverTop10HTML 내부에서 모바일/PC 결정)
        const html = await fetchNaverTop10HTML(keyword, randX, randY);

        // parse
        const top10 = parseNaverTop10(html);

        return { rank, keyword, monthlySearchVolume, top10 };
      } catch (err) {
        console.error(`[ERROR] keyword=${keyword} fetch/parse error:`, err);
        return null;
      }
    });

    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter((r) => r));

    index += batchSize;

    // 1~4초 랜덤 대기
    await randomDelay(1, 4);
  }

  // group
  const grouped = groupByTop10(results);

  return grouped.map((group) => {
    const combinedKeyword = group.items.map((it) => it.keyword).join(", ");
    const details = group.items.map((it) => ({
      rank: it.rank,
      monthlySearchVolume: it.monthlySearchVolume,
    }));
    return { combinedKeyword, details };
  });
}