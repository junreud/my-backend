// services/naverAdApiService.js
const axios = require('axios');
const crypto = require('crypto');

// 실제로는 .env나 config 파일에서 불러오세요
const API_KEY = 'YOUR_API_KEY';
const SECRET_KEY = 'YOUR_SECRET_KEY';
const CUSTOMER_ID = 'YOUR_CUSTOMER_ID';

// 네이버 검색광고 API 베이스 URL (예시)
const BASE_URL = 'https://api.naver.com';

function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

/**
 * 네이버 검색광고 API(예: 키워드도구)로부터
 * 키워드별 월검색수, CPC, 경쟁도(난이도) 등 외부 지표를 가져온다 (예시)
 * 
 * @param {string[]} keywords
 * @returns {Promise<Array<{
 *   keyword: string,
 *   monthlySearchVolume: number,
 *   cpc: number,
 *   competition: number
 * }>>}
 */
async function getKeywordDataFromNaver(keywords = []) {
  if (!keywords.length) return [];

  // 예시: GET /keywordstool
  const method = 'GET';
  const uri = '/keywordstool';
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, uri, SECRET_KEY);

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
      hintKeywords: keywords.join(','),
      showDetail: 1
      // 필요한 파라미터 (actual doc 참고)
    }
  };

  try {
    const response = await axios(config);
    // 실제 응답 구조에 맞춰 파싱
    if (response.data && response.data.keywordList) {
      return response.data.keywordList.map(item => {
        const kw = item.relKeyword;
        const monthlyVol = (item.monthlyPcQcCnt || 0) + (item.monthlyMobileQcCnt || 0);
        const cpc = item.pcCpc ? parseInt(item.pcCpc, 10) : 0;
        const competition = item.compIdx ? parseFloat(item.compIdx) : 0;
        return {
          keyword: kw,
          monthlySearchVolume: monthlyVol,
          cpc,
          competition
        };
      });
    }
    return [];
  } catch (err) {
    console.error('[ERROR] getKeywordDataFromNaver:', err.message);
    return [];
  }
}

module.exports = {
  getKeywordDataFromNaver
};
