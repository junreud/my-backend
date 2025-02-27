// services/naverPlaceFullService.js
import axios from 'axios';
import { MOBILE_USER_AGENT, PROXY_SERVER } from '../config/crawler.js';
import HttpsProxyAgent from 'https-proxy-agent';

/**
 * 최종 메인 함수:
 *  1) Axios로 업체 디테일 정보 + 대표키워드
 *  2) Puppeteer로 블로그리뷰 10개 + 업체소개글
 *  3) 통합하여 반환
 */
async function getNaverPlaceFullInfo(placeUrl) {
  // 1) Axios 파트
  const axiosResult = await getPlaceDetailWithAxios(placeUrl);

  // 2) Puppeteer 파트
  const puppeteerResult = await getReviewAndIntroWithPuppeteer(placeUrl);

  // 3) 합쳐서 반환
  return {
    ...axiosResult,           // { placeId, name, category, address, roadAddress, keywordList }
    blogReviewTitles: puppeteerResult.blogReviewTitles,  // 최대 10개
    shopIntro: puppeteerResult.shopIntro                 // 업체 소개글
  };
}

/* ------------------------------------------------------------------
   1. AXIOS로 업체 정보(디테일) + 대표키워드 파싱
------------------------------------------------------------------ */
async function getPlaceDetailWithAxios(placeUrl) {
  try {
    let agent = null;
    if (PROXY_SERVER && PROXY_SERVER.trim() !== '') {
      agent = new HttpsProxyAgent(PROXY_SERVER);
      console.log('[INFO] Using proxy for Axios:', PROXY_SERVER);
    }

    const { data: html } = await axios.get(placeUrl, {
      headers: {
        'User-Agent': MOBILE_USER_AGENT,
      },
      ...(agent ? { httpsAgent: agent, httpAgent: agent } : {}),
    });

    // window.__APOLLO_STATE__ 추출
    const match = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (!match) {
      console.warn('[WARN] getPlaceDetailWithAxios - __APOLLO_STATE__ not found');
      return {
        placeId: null,
        name: null,
        category: null,
        address: null,
        roadAddress: null,
        keywordList: []
      };
    }

    const jsonString = match[1];
    const apolloData = JSON.parse(jsonString);

    // 업체 정보 (placeId, name, category, address, roadAddress)
    const placeDetail = parsePlaceDetail(apolloData);
    // 대표 키워드
    const keywordList = findKeywordListDfs(apolloData);

    return {
      ...placeDetail,
      keywordList
    };
  } catch (err) {
    console.error('[ERROR] getPlaceDetailWithAxios:', err.message);
    return {
      placeId: null,
      name: null,
      category: null,
      address: null,
      roadAddress: null,
      keywordList: []
    };
  }
}

// (A) 업체 디테일 파싱
function parsePlaceDetail(apolloData) {
  const possiblePrefixes = [
    'PlaceDetailBase:',
    'RestaurantDetailBase:',
    'HairshopDetailBase:',
    // 필요시 추가
  ];
  const detailKey = Object.keys(apolloData).find(k =>
    possiblePrefixes.some(prefix => k.startsWith(prefix))
  );
  if (!detailKey) return {};

  const detailObj = apolloData[detailKey];
  return {
    placeId: detailObj.id,
    name: detailObj.name,
    category: detailObj.category,
    address: detailObj.address,
    roadAddress: detailObj.roadAddress
  };
}

// (B) 대표 키워드(keywordList) 파싱
/**
 * apolloData 내부를 재귀적으로 탐색하여,
 * "keywordList" 키가 배열(Array)인 곳을 찾아 반환
 * 
 * @param {object} node   - 탐색할 노드 (초기에는 apolloData)
 * @returns {array|null}  - 찾으면 해당 배열, 못 찾으면 null
 */
function findKeywordListDfs(node) {
  // node가 객체인지 확인
  if (node && typeof node === 'object') {
    // 1) 현재 node에 "keywordList"가 있는지 확인
    if (Array.isArray(node.keywordList)) {
      return node.keywordList;
    }
    // 2) 없다면, node의 하위 프로퍼티(값)들을 재귀적으로 탐색
    for (const key of Object.keys(node)) {
      const child = node[key];
      // 재귀 호출
      const result = findKeywordListDfs(child);
      if (result) {
        // 한 번 찾으면 바로 반환
        return result;
      }
    }
  }
  // 객체가 아니거나 못 찾았으면 null
  return null;
}
/* ------------------------------------------------------------------
   Puppeteer로 블로그리뷰 최대 10개 + 업체 소개글 파싱
------------------------------------------------------------------ */
async function getReviewAndIntroWithPuppeteer(placeUrl, userAgent, proxyServer) {
  const puppeteer = require('puppeteer');

  let browser;
  try {
    // 브라우저 실행 옵션
    const launchOptions = {
      headless: 'new'  // 최신 버전 헤드리스
    };

    // 프록시 설정 (옵션)
    if (proxyServer && proxyServer.trim() !== '') {
      launchOptions.args = [`--proxy-server=${proxyServer}`];
    }

    // 브라우저 실행
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // User-Agent 지정 (모바일 UA 등)
    const finalUa = userAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)';
    await page.setUserAgent(finalUa);

    // (A) 블로그 리뷰 최대 10개
    const reviewUrl = `${placeUrl}/review/ugc?type=photoView`;
    await page.goto(reviewUrl, { waitUntil: 'domcontentloaded' });

    // 요소 등장 대기 - 리뷰 셀렉터
    const reviewSelector = '.pui__dGLDWy';
    await page.waitForSelector(reviewSelector, { timeout: 8000 });

    // 리뷰 제목들 추출
    const reviewTitles = await page.evaluate((sel) => {
      const els = document.querySelectorAll(sel);
      const arr = [];
      for (let i = 0; i < els.length; i++) {
        arr.push(els[i].textContent.trim());
      }
      return arr;
    }, reviewSelector);

    // 최대 10개만
    const blogReviewTitles = reviewTitles.slice(0, 10);

    // (B) 업체 소개글
    const infoUrl = `${placeUrl}/information`;
    await page.goto(infoUrl, { waitUntil: 'domcontentloaded' });

    // 요소 등장 대기 - 업체 소개글 셀렉터
    const introSelector = '.T8RFa.CEyr5';
    await page.waitForSelector(introSelector, { timeout: 8000 });

    // 소개글 추출
    const shopIntro = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent.trim() : '';
    }, introSelector);

    // 결과 반환
    return { blogReviewTitles, shopIntro };
  } catch (err) {
    // 에러 발생 시 빈값 반환
    return { blogReviewTitles: [], shopIntro: '' };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
/* ------------------------------------------------------------------
   내보내기 (최종)
------------------------------------------------------------------ */
module.exports = {
  getNaverPlaceFullInfo
};

//--------------------------------------------------------------------
// CLI 직접 실행 (node services/naverPlaceFullService.js)
//--------------------------------------------------------------------
if (require.main === module) {
  (async () => {
    // 예시: 사당역 술집 - '낯선한식븟다'
    const placeUrl = 'https://m.place.naver.com/restaurant/1971062401';
    console.log('[INFO] placeUrl =', placeUrl);

    const finalInfo = await getNaverPlaceFullInfo(placeUrl);
    console.log('[INFO] Result =');
    console.log(JSON.stringify(finalInfo, null, 2));
  })();
}
