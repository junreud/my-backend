// keywordSearchVolume.js
import 'dotenv/config';
import axios from 'axios';
import crypto from 'crypto';

const API_KEY = process.env.NAVER_AD_API_KEY || '';
const SECRET_KEY = process.env.NAVER_AD_API_SECRET || '';
const CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID || '';

const BASE_URL = 'https://api.naver.com';
const PATH = '/keywordstool';

function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('base64');
}

/**
 * 한 번에 최대 5개로 제한 -> 여러번 호출 병합
 * @param {string[]} keywords  입력 키워드들
 * @returns {Promise<Array<{keyword: string, monthlySearchVolume: number, pcCpc: number, competition: number}>>}
 */
async function getSearchVolumeCpcCompetition(keywords = []) {
  if (!API_KEY || !SECRET_KEY || !CUSTOMER_ID) {
    console.error('[ERROR] NaverAdApi: missing environment variables');
    return [];
  }
  if (!keywords.length) return [];

  const chunkSize = 5;
  const mergedResults = [];

  for (let i = 0; i < keywords.length; i += chunkSize) {
    const slice = keywords.slice(i, i + chunkSize);
    const partial = await fetchKeywordToolSlice(slice);
    mergedResults.push(...partial);
  }

  // 원본 순서 보장 or 검색량 정렬 여부는 필요에 따라
  // 아래서는 "키워드명"으로 map을 만들고, keywords 순서대로 반환
  const volumeMap = {};
  mergedResults.forEach(item => {
    volumeMap[item.keyword] = item;
  });

  const finalArr = keywords.map(kw => {
    return volumeMap[kw] || {
      keyword: kw,
      monthlySearchVolume: 0,
      pcCpc: 0,
      competition: 0
    };
  });

  return finalArr;
}

/**
 * 실제 /keywordstool 호출 (최대 5개의 slice)
 */
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
        'X-Signature': signature
      },
      params: {
        hintKeywords,
        showDetail: 1
      }
    };

    const resp = await axios(config);
    const list = resp.data?.keywordList || [];

    return list.map(item => {
      const kw = item.relKeyword;
      const monthlyVol = parseInt(item.monthlyPcQcCnt || 0, 10)
                      + parseInt(item.monthlyMobileQcCnt || 0, 10);
      const cpcVal = item.pcCpc ? parseInt(item.pcCpc, 10) : 0;
      const compVal = item.compIdx ? parseFloat(item.compIdx) : 0;

      return {
        keyword: kw,
        monthlySearchVolume: monthlyVol,
        pcCpc: cpcVal,
        competition: compVal
      };
    });
  } catch (err) {
    console.error('[ERROR] fetchKeywordToolSlice:', err.response?.data || err.message);
    return [];
  }
}

// 테스트
if (require.main === module) {
  (async () => {
    const sampleKeywords = [
      '사당맛집','이수역맛집','막걸리','곱창','술집','피자','카페','커피','치킨','삼겹살'
    ];
    console.log('[TEST] getSearchVolumeCpcCompetition =>', sampleKeywords);

    const results = await getSearchVolumeCpcCompetition(sampleKeywords);
    console.log('\n=== Final Result ===');
    results.forEach(r => {
      console.log(
        `"${r.keyword}": volume=${r.monthlySearchVolume}, cpc=${r.pcCpc}, comp=${r.competition}`
      );
    });
  })();
}

module.exports = {
  getSearchVolumeCpcCompetition
};
