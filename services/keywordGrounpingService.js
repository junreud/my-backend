// keywordGroupingExample.js
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { MOBILE_USER_AGENT } from '../config/crawler.js';

/**
 * 1. 주어진 키워드를 모바일 네이버에서 검색하여,
 *    검색 결과 상위 10개 업체명을 배열로 반환하는 함수
 */
export async function crawlTop10NaverResults(keyword) {
  let browser;
  try {
    // Puppeteer 실행
    browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    // 모바일 User-Agent 지정
    await page.setUserAgent(MOBILE_USER_AGENT);

    // 네이버 모바일 검색 URL
    const url = `https://m.place.naver.com/place/list?query=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // 검색 결과 목록 셀렉터 대기
    await page.waitForSelector('li.UEzoS', { timeout: 8000 });

    // 최대 10개만 추출
    let items = await page.$$('li.UEzoS');
    items = items.slice(0, 10);

    // 각 아이템에서 업체명 추출
    const top10Names = [];
    for (const item of items) {
      const name = await item.$eval('.place_bluelink', el => el.textContent.trim());
      top10Names.push(name);
    }

    return top10Names;
  } catch (err) {
    console.error(`[ERROR] crawlTop10NaverResults(${keyword}):`, err.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 2. “동일한 Top10”을 가지는 키워드를 한 그룹으로 묶는 함수
 *    - 입력: [{ keyword, monthlySearchVolume, top10 }, ...]
 *    - 출력: [{
 *        top10: string[],
 *        items: [
 *          { keyword: string, monthlySearchVolume: number },
 *          ...
 *        ]
 *      }, ...]
 */
function groupByTop10(list) {
  // key: top10 배열을 문자열로 합친 시그니처
  const map = new Map();

  list.forEach(item => {
    // 배열 -> 문자열 키
    const signature = item.top10.join('|'); // 업체명 배열을 |로 결합

    if (!map.has(signature)) {
      map.set(signature, {
        top10: item.top10,
        items: [],
      });
    }

    // items 배열에 {keyword, monthlySearchVolume}만 저장
    map.get(signature).items.push({
      keyword: item.keyword,
      monthlySearchVolume: item.monthlySearchVolume,
    });
  });

  // map의 value들을 배열로 변환
  return Array.from(map.values());
}

/**
 * 3. 키워드 리스트를 받아서 각 키워드별 mobile naver top10 수집 후,
 *    동일한 top10 결과를 한 그룹으로 묶어 리턴
 */
export async function groupKeywordsByNaverTop10(keywordList) {
  // 키워드 리스트 예시
  // [
  //   { keyword: '사당맛집', monthlySearchVolume: 12532 },
  //   { keyword: '이수역맛집', monthlySearchVolume: 11345 },
  //   ...
  // ]

  // (1) 키워드별 Top10 파싱
  const results = [];
  for (const item of keywordList) {
    const { keyword, monthlySearchVolume } = item;

    // Top10 조회
    const top10 = await crawlTop10NaverResults(keyword);

    // 결과 저장
    results.push({
      keyword,
      monthlySearchVolume,
      top10,
    });

    // 필요 시 딜레이 (너무 빠른 요청으로 인한 차단 방지)
    await new Promise(r => setTimeout(r, 500));
  }

  // (2) 동일한 Top10 결과를 한 그룹으로 묶기
  const grouped = groupByTop10(results);

  // (3) 최종 결과 리턴
  return grouped;
}

// ______________________________________________
// 4. 직접 실행 시 main() 호출하여 테스트
// ______________________________________________
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (__filename === process.argv[1]) {
  (async () => {
    // 가정) 테스트용 키워드+검색량 리스트
    const keywordList = [
      { keyword: '사당맛집', monthlySearchVolume: 12532 },
      { keyword: '이수역맛집', monthlySearchVolume: 8421 },
      { keyword: '사당술집', monthlySearchVolume: 7102 },
      { keyword: '이수술집', monthlySearchVolume: 6999 },
      { keyword: '동작구맛집', monthlySearchVolume: 5200 },
      { keyword: '동작구술집', monthlySearchVolume: 3001 },
      { keyword: '사당고기집', monthlySearchVolume: 2400 },
    ];

    // 그룹화 함수 실행
    const groupedResult = await groupKeywordsByNaverTop10(keywordList);

    // 콘솔 출력 예시
    console.log('\n===== Grouped by top10 =====');
    groupedResult.forEach((group, idx) => {
      console.log(`\n[Group ${idx + 1}]`);
      console.log(` top10 -> [${group.top10.join(', ')}]`);
      console.log(' items ->', group.items);
    });
  })();
}
