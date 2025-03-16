// services/naverAdApiService.js
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
// 4) 실제 /keywordstool (최대 5개) 호출
// ---------------------------------------------------------
async function fetchKeywordToolSlice(sliceKeywords) {
  if (!sliceKeywords.length) return [];

  try {
    const timestamp = Date.now().toString();
    const method = 'GET';
    const uri = PATH;
    const signature = generateSignature(timestamp, method, uri, SECRET_KEY);

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
// 3) (메인) 검색량 정보 가져오기
//    - 중복 키워드 제거
//    - 한 번에 최대 5개씩 호출, 각 청크 처리 후 0.5초 대기
//    - 검색량 0(또는 null)인 항목은 제거
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

  // 1) 중복 제거 (대소문자 구분이 필요 없다면 toLowerCase() 등 추가 가능)
  const uniqueKeywords = [...new Set(keywords)];

  const chunkSize = 5;
  const mergedResults = [];

  // 2) 키워드를 5개 단위로 잘라서 순차 호출
  for (let i = 0; i < uniqueKeywords.length; i += chunkSize) {
    const slice = uniqueKeywords.slice(i, i + chunkSize);
    console.log('Calling fetchKeywordToolSlice with:', slice); // 디버그

    const partial = await fetchKeywordToolSlice(slice);
    mergedResults.push(...partial);

    // 0.5초 지연
    await sleep(200);
  }

  // 3) volumeMap[키워드] => { keyword, monthlySearchVolume }
  const volumeMap = {};
  mergedResults.forEach(item => {
    volumeMap[item.keyword] = item;
  });

  // 4) 키워드 입력 순서(혹은 uniqueKeywords 순서)대로 배열 구성
  //    - 혹시 검색량 정보가 없으면 0 처리
  const finalArr = uniqueKeywords.map(kw => {
    return volumeMap[kw] || { keyword: kw, monthlySearchVolume: 0 };
  });

  // 5) 검색량이 50 이하인 항목은 제외
  const filteredArr = finalArr.filter((item) => item.monthlySearchVolume && item.monthlySearchVolume > 50);

  // 6) 검색량 기준 내림차순 정렬
  const sortedArr = filteredArr.sort((a, b) => b.monthlySearchVolume - a.monthlySearchVolume);

  // 7) rank 부여
  const rankedArr = sortedArr.map((item, idx) => ({
    rank: idx + 1,
    keyword: item.keyword,
    monthlySearchVolume: item.monthlySearchVolume,
  }));

  return rankedArr;
}

// ---------------------------------------------------------
// [Test] ESM 직접 실행 (node services/naverAdApiService.js)
// ---------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function runTest() {
  (async () => {
    const sampleKeywords = [
      "사당역헬스장",
      "사당역pt",
      "사당역pt",  // 중복 예시
      "사당동헬스장",
      "이수역헬스장",
      "관악구헬스장",
      "남현동헬스장",
      "사당역최고급헬스장",
      "사당역청결한헬스장",
      "사당역친절한헬스장",
      "사당역신뢰받는헬스장",
      "사당역개인화장대헬스장",
      "사당역고급스파헬스장",
      "사당역최고급머신헬스장",
      "사당역운동루틴헬스장",
      "사당역다이어트헬스장",
      "사당역여자헬스초보헬스장",
      "사당역상체운동헬스장",
      "사당역하체운동헬스장",
      "사당역하체운동헬스장", // 중복 예시
    ];
    console.log('[TEST] getSearchVolumes =>', sampleKeywords);

    const results = await getSearchVolumes(sampleKeywords);
    console.log('\n=== Final Result ===');
    results.forEach(r => {
      console.log(`${r.rank}등 | "${r.keyword}" => volume=${r.monthlySearchVolume}`);
    });
  })();
}

if (__filename === process.argv[1]) {
  runTest();
}
