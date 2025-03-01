// services/naverAdApiService.js (ESM 버전)
import 'dotenv/config';
import axios from 'axios';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const API_KEY = process.env.NAVER_AD_API_KEY || '';
const SECRET_KEY = process.env.NAVER_AD_API_SECRET || '';
const CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID || '';

const BASE_URL = 'https://api.naver.com';
const PATH = '/keywordstool';

// ---------------------------------------------------------
// 1) sleep 함수 (0.5초 지연)
// ---------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------
// 2) 시그니처 생성
// ---------------------------------------------------------
function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('base64');
}

// ---------------------------------------------------------
// 3) (메인) 검색량 정보 가져오기
//    - 한 번에 최대 5개씩 호출, 각 청크 처리 후 0.5초 대기
//    - 최종적으로 검색량 내림차순 정렬 및 rank 추가
// ---------------------------------------------------------
/**
 * @param {string[]} keywords 키워드 배열
 * @returns {Promise<Array<{ rank: number, keyword: string, monthlySearchVolume: number }>>}
 */
export async function getSearchVolumes(keywords = []) {
  if (!API_KEY || !SECRET_KEY || !CUSTOMER_ID) {
    console.error('[ERROR] NaverAdApi: missing environment variables');
    return [];
  }
  if (!keywords.length) {
    console.warn('[WARN] No keywords provided');
    return [];
  }

  const chunkSize = 5;
  const mergedResults = [];

  // 키워드를 5개 단위로 잘라서 순차 호출
  for (let i = 0; i < keywords.length; i += chunkSize) {
    // 3-1) slice 추출
    const slice = keywords.slice(i, i + chunkSize);

    // 3-2) API 호출 (키워드 최대 5개)
    const partial = await fetchKeywordToolSlice(slice);
    mergedResults.push(...partial);

    // 3-3) Too Many Requests 방지를 위해 0.5초 대기
    await sleep(500);
  }

  // volumeMap[키워드] => { keyword, monthlySearchVolume }
  const volumeMap = {};
  mergedResults.forEach(item => {
    volumeMap[item.keyword] = item;
  });

  // 키워드 입력 순서대로 기본 배열을 구성 (없으면 검색량 0)
  const finalArr = keywords.map(kw => {
    return volumeMap[kw] || { keyword: kw, monthlySearchVolume: 0 };
  });

  // ---- (추가) 검색량 기준 내림차순 정렬 + rank 부여
  const sortedArr = [...finalArr].sort((a, b) => b.monthlySearchVolume - a.monthlySearchVolume);
  const rankedArr = sortedArr.map((item, idx) => ({
    rank: idx + 1,
    keyword: item.keyword,
    monthlySearchVolume: item.monthlySearchVolume,
  }));

  // 내림차순+순위가 매겨진 배열 반환
  return rankedArr;
}

// ---------------------------------------------------------
// 4) 실제 /keywordstool (최대 5개) 호출
// ---------------------------------------------------------
async function fetchKeywordToolSlice(sliceKeywords) {
  if (!sliceKeywords.length) return [];

  try {
    const timestamp = Date.now().toString();
    const method = 'GET';
    const uri = PATH;
    const signature = generateSignature(timestamp, method, uri, SECRET_KEY);

    // 키워드 연결 (필요시 encodeURIComponent 고려)
    const hintKeywords = sliceKeywords.join(',');

    const config = {
      method,
      baseURL: BASE_URL,
      url: uri,
      headers: {
        'X-Timestamp': timestamp,
        'X-API-KEY': API_KEY,
        'X-Customer': CUSTOMER_ID,
        'X-Signature': signature,
      },
      params: {
        hintKeywords,
        showDetail: 1,
      },
    };

    const resp = await axios(config);
    const list = resp.data?.keywordList || [];

    // 결과 가공
    return list.map(item => {
      const kw = item.relKeyword;
      const monthlyVol =
        parseInt(item.monthlyPcQcCnt || 0, 10) +
        parseInt(item.monthlyMobileQcCnt || 0, 10);

      return {
        keyword: kw,
        monthlySearchVolume: monthlyVol,
      };
    });
  } catch (err) {
    console.error('[ERROR] fetchKeywordToolSlice:', err.response?.data || err.message);
    return [];
  }
}

// ---------------------------------------------------------
// [Test] ESM 직접 실행 (node services/naverAdApiService.js)
// ---------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function runTest() {
  (async () => {
    const sampleKeywords = ["이수역헬스장","이수역PT","사당동헬스장","사당동PT","동작구헬스장","동작구PT","이수역여성전용헬스장","사당여성전용헬스장","이수역피트니스","사당동피트니스","이수역여성전문피트니스","사당동여성전문피트니스","이수역코어운동","사당동코어운동","이수역헬스운동","사당동헬스운동","이수역운동복","사당동운동복","이수역PT추천","사당동PT추천","이수역여성전문PT","사당동여성전문PT","이수역프리미엄헬스장","사당동프리미엄헬스장"];
    console.log('[TEST] getSearchVolumes =>', sampleKeywords);

    const results = await getSearchVolumes(sampleKeywords);
    console.log('\n=== Final Result ===');
    results.forEach(r => {
      console.log(`${r.rank}등 | "${r.keyword}" => volume=${r.monthlySearchVolume}`);
    });
  })();
}

// “직접 실행” 시 테스트
if (__filename === process.argv[1]) {
  runTest();
}
