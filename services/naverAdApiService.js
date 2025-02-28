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
// ---------------------------------------------------------
/**
 * @param {string[]} keywords 키워드 배열
 * @returns {Promise<Array<{ keyword: string, monthlySearchVolume: number }>>}
 *  - monthlySearchVolume 만 반환
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

  // 키워드 입력 순서대로 결과 구성 (monthSearchVolume가 없으면 0)
  const finalArr = keywords.map(kw => {
    return volumeMap[kw] || { keyword: kw, monthlySearchVolume: 0 };
  });

  return finalArr;
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
      // 키워드명
      const kw = item.relKeyword;
      // PC + 모바일 검색량 합산
      const monthlyVol =
        parseInt(item.monthlyPcQcCnt || 0, 10) +
        parseInt(item.monthlyMobileQcCnt || 0, 10);

      return {
        keyword: kw,
        monthlySearchVolume: monthlyVol
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
    const sampleKeywords = [
      '사당맛집', '이수역맛집', '동작구맛집'
    ];
    console.log('[TEST] getSearchVolumes =>', sampleKeywords);

    const results = await getSearchVolumes(sampleKeywords);
    console.log('\n=== Final Result ===');
    results.forEach(r => {
      console.log(`"${r.keyword}": volume=${r.monthlySearchVolume}`);
    });
  })();
}

// “직접 실행” 시 테스트
if (__filename === process.argv[1]) {
  runTest();
}
