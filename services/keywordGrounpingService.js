// keywordGroupingExample.js
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { MOBILE_USER_AGENT } from '../config/crawler.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 
 * 무작위 좌표 생성 (baseX, baseY) 중심으로 radiusM 안에 위치 
 * - 1도 ≈ 111,320m를 가정하여 단순 계산
 */
function getRandomCoords(baseX, baseY, radiusM = 300) {
  const distance = Math.random() * radiusM;  // 0 ~ radiusM 사이 무작위 거리
  const angle = Math.random() * 2 * Math.PI; // 0 ~ 360도(라디안)
  const lat0Rad = (baseY * Math.PI) / 180;

  const deltaLat = (distance * Math.cos(angle)) / 111320;
  const deltaLng =
    (distance * Math.sin(angle)) /
    (111320 * Math.cos(lat0Rad));

  return {
    randY: baseY + deltaLat,
    randX: baseX + deltaLng,
  };
}

/**
 * 주어진 페이지(tab)에서 특정 키워드를 모바일 네이버에 검색하여
 * 광고 업체를 제외한 (data-laim-exp-id === 'undefined') 상위 10개 업체명을 배열로 반환
 */
async function crawlTop10NaverResults(page, keyword) {
  // (1) 랜덤 좌표 생성 (예: 서울시청 인근 기준, 반경 300m)
  const baseX = 126.977; // 서울시청 근방 경도
  const baseY = 37.5665; // 서울시청 근방 위도
  const { randX, randY } = getRandomCoords(baseX, baseY, 300);

  // (2) 네이버 모바일 검색 URL (좌표 포함)
  //    &level=top, &entry=pll 추가는 예시(옵션)
  const url = `https://m.place.naver.com/place/list?query=${encodeURIComponent(keyword)}&x=${randX}&y=${randY}&level=top&entry=pll`;
  console.log(`>>> [${keyword}] final search URL:`, url);

  // (3) 페이지 이동
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // (4) 검색 결과 목록 셀렉터 대기
  await page.waitForSelector('h1#_header.bh9OH', { timeout: 8000 });

  // (5) 모든 업체 목록 가져오기
  const allItems = await page.$$('li.VLTHu');

  // (6) 광고 업체(laim-exp-id !== 'undefined') 제외, 실제 업체만 추출
  const realItems = [];
  for (const li of allItems) {
    const laimExpId = await li.evaluate(el => el.getAttribute('data-laim-exp-id'));
    if (laimExpId === 'undefined') {
      realItems.push(li);
    }
  }

  // 최대 10개만 추출
  const topItems = realItems.slice(0, 10);

  // (7) 각 아이템에서 업체명 추출 ('.YwYLL' 사용)
  const top10Names = [];
  for (const item of topItems) {
    const name = await item.$eval('.YwYLL', el => el.textContent.trim());
    top10Names.push(name);
  }

  return top10Names;
}

/**
 * “동일한 Top10”을 가지는 키워드를 한 그룹으로 묶는 함수
 *    - 입력: [{ rank, keyword, monthlySearchVolume, top10 }, ...]
 *    - 출력: [{
 *        top10: string[],
 *        items: [
 *          { rank, keyword, monthlySearchVolume },
 *          ...
 *        ]
 *      }, ...]
 */
function groupByTop10(list) {
  const map = new Map();

  list.forEach(item => {
    // Top10 배열 -> '|'로 이어붙여 문자열 키를 만듦
    const signature = item.top10.join('|');

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
 * 키워드 리스트를 받아서 각 키워드별 mobile naver top10 업체 수집 후,
 * 동일한 top10 결과를 한 그룹으로 묶어 리턴
 * 
 * - 여기서는 "키워드마다 새 탭을 열어" 검색 (headless: false로 하면 탭이 실제로 보임)
 */
export async function groupKeywordsByNaverTop10(keywordList) {
  // 1) Puppeteer 브라우저 한 번만 열기 (headless: false => 실제 창)
  const browser = await puppeteer.launch({ headless: 'new' });
  const results = [];

  try {
    // 2) 모든 키워드에 대해 순회하며, 새 탭을 열고 검색
    for (const item of keywordList) {
      const { rank, keyword, monthlySearchVolume } = item;

      // 새 탭 생성
      const page = await browser.newPage();
      await page.setUserAgent(MOBILE_USER_AGENT);

      // Top10 조회
      const top10 = await crawlTop10NaverResults(page, keyword);

      // 결과 저장
      results.push({
        rank,
        keyword,
        monthlySearchVolume,
        top10,
      });

      // 필요 시 딜레이 (너무 빠른 요청으로 인한 차단 방지)
      await new Promise(r => setTimeout(r, 1000));
    }

    // 3) 동일한 Top10 결과를 한 그룹으로 묶기
    const grouped = groupByTop10(results);
    return grouped;

  } catch (err) {
    console.error('groupKeywordsByNaverTop10 Error:', err);
    return [];
  } finally {
    /**
     * 탭을 그대로 유지하고 싶다면, 여기서 브라우저를 닫지 말고 주석 처리하거나,
     * 임시로 일정 시간 대기 후 닫을 수도 있습니다.
     */
    // await new Promise(r => setTimeout(r, 30000)); // 30초 뒤 닫기 (예시)
    // await browser.close();
  }
}

// ______________________________________________
// 4. 직접 실행 시 main() 호출 (테스트용)
// ______________________________________________
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (__filename === process.argv[1]) {
  (async () => {
    // 예시 키워드 리스트
    const keywordList = [
      { rank: 1, keyword: '사당역맛집', monthlySearchVolume: 82000 },
      { rank: 2, keyword: '사당맛집', monthlySearchVolume: 5400 },
      { rank: 3, keyword: '사당역고기집', monthlySearchVolume: 2000 },
      { rank: 4, keyword: '사당역술집', monthlySearchVolume: 9000 },
      { rank: 5, keyword: '사당고기집', monthlySearchVolume: 12000 },
    ];

    // 그룹화 함수 실행
    const groupedResult = await groupKeywordsByNaverTop10(keywordList);

    // 콘솔에 결과 출력
    console.log('\n===== Grouped by top10 =====');
    groupedResult.forEach((group, idx) => {
      console.log(`\n[Group ${idx + 1}]`);
      console.log(` top10 -> [${group.top10.join(', ')}]`);
      console.log(' items ->', group.items);
    });
  })();
}
