// keywordGroupingExample.js
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// (가정) 이미 존재하는 getSearchVolumes 함수 import
// - 예: 사용자가 만든 "myVolumeService.js" 등에 구현됨
import { getSearchVolumes } from './myVolumeService.js';

// ______________________________________________
// 1. 모바일 네이버 검색 결과 (상위 10개) 가져오는 함수
// ______________________________________________
async function crawlTop10NaverResults(keyword) {
  let browser;
  try {
    // Puppeteer 실행
    browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    // 모바일 User-Agent 지정
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15A372 Safari/604.1'
    );

    // 네이버 모바일 검색 URL
    const url = `https://m.place.naver.com/restaurant/list?query=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // 검색 결과 목록 셀렉터 대기 (li.UEzoS 등)
    await page.waitForSelector('li.UEzoS', { timeout: 8000 });

    // 최대 10개만 추출
    let items = await page.$$('li.UEzoS');
    items = items.slice(0, 10);

    // 각 아이템에서 "업체명" 추출
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

// ______________________________________________
// 2. “동일한 Top10”을 가지는 키워드를 한 그룹으로 묶는 함수
//    - 예: { keyword, monthlySearchVolume, top10: [...10개 업체명...] }
// ______________________________________________
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
    map.get(signature).items.push(item);
  });

  // map의 value들을 배열로 변환
  //   { top10: [...], items: [{keyword, monthlySearchVolume, top10}, ...], ... }
  return Array.from(map.values()).map(entry => ({
    top10: entry.top10,
    keywords: entry.items.map(it => it.keyword),
    volumes: entry.items.map(it => it.monthlySearchVolume),
  }));
}

// ______________________________________________
// 3. 메인 로직
//    - 검색량 → 내림차순 정렬
//    - 각 키워드별 mobile top10 → 묶기
// ______________________________________________
async function main() {
  // (가정) 테스트할 키워드들
  const keywords = [
    '사당맛집', '이수역맛집', '사당술집', '이수술집',
    '동작구맛집', '동작구술집', '사당고기집'
  ];

  // (1) 검색량 가져오기 (이미 구현된 함수 사용)
  //     [{ keyword, monthlySearchVolume }, ...]
  const volumes = await getSearchVolumes(keywords);

  // (2) 검색량 내림차순 정렬
  volumes.sort((a, b) => b.monthlySearchVolume - a.monthlySearchVolume);

  // (3) 각 키워드 별 mobile naver top10 파싱
  //     => { keyword, monthlySearchVolume, top10 }
  const results = [];
  for (const v of volumes) {
    const top10 = await crawlTop10NaverResults(v.keyword);
    results.push({
      keyword: v.keyword,
      monthlySearchVolume: v.monthlySearchVolume,
      top10
    });

    // 원하는 만큼 딜레이 (예: 1초) → too many requests 방지
    await new Promise(r => setTimeout(r, 1000));
  }

  // (4) 동일 top10 결과를 한 그룹으로 묶기
  const grouped = groupByTop10(results);

  // (5) 콘솔에 출력 예시
  console.log('\n===== Grouped by top10 =====');
  grouped.forEach((group, idx) => {
    console.log(`\n[Group ${idx + 1}]`);
    console.log(` top10 -> [${group.top10.join(', ')}]`);
    console.log(` keywords -> [${group.keywords.join(', ')}]`);
    console.log(` volumes -> [${group.volumes.join(', ')}]`);
  });
}

// ______________________________________________
// 4. 직접 실행 시 main() 호출
// ______________________________________________
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (__filename === process.argv[1]) {
  (async () => {
    await main();
  })();
}
