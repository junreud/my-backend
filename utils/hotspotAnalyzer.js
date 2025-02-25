/**
 * services/hotspotAnalyzer.js
 *
 * 1) 내 업체명으로 네이버 블로그를 검색
 * 2) 제목/요약을 간단한 텍스트 마이닝
 * 3) 리뷰 수가 부족하면 → 근처 업체를 추가로 검색
 * 4) 최종적으로 "핫스팟" 후보(역, 스키장, etc.) 추출
 */

const axios = require('axios');
const cheerio = require('cheerio'); // 혹은 아래처럼 JSON 응답이면 cheerio 없이 가능
// const { runCrawler } = require('./crawlerService'); // 필요시
// ...등등

// 네이버 검색 API 인증 정보 (데모)
const NAVER_CLIENT_ID = 'YOUR_CLIENT_ID';
const NAVER_CLIENT_SECRET = 'YOUR_CLIENT_SECRET';

/**
 * (A) 네이버 블로그 검색 API 예시
 * query: 검색어 (업체명 등)
 * display: 가져올 최대 문서 수(기본 10, 최대 100)
 */
async function searchNaverBlog(query, display = 20) {
  const url = 'https://openapi.naver.com/v1/search/blog.json';
  try {
    const response = await axios.get(url, {
      params: {
        query,
        display
      },
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
      }
    });
    // JSON 데이터
    const items = response.data.items; // [{title, link, description, ...}, ...]
    return items;
  } catch (err) {
    console.error('searchNaverBlog Error:', err);
    return [];
  }
}

/**
 * (B) 텍스트 마이닝 (간단 버전)
 * 리뷰 제목/요약들에서 "역", "스키장", "대학", "시청", "구", "동" 등의 토큰을 카운트
 * + "곤지암", "코엑스", "명동" 같은 대표 키워드 사전도 검색
 */
function extractHotspotKeywords(blogData) {
  // blogData: 배열 [{title, description, ...}, ...]
  // 1) 모든 title + description 을 하나의 텍스트로 합침
  let bigText = '';
  blogData.forEach(item => {
    const title = item.title || '';
    const desc = item.description || '';
    // HTML 태그 제거
    const titlePlain = title.replace(/<[^>]*>/g, '');
    const descPlain = desc.replace(/<[^>]*>/g, '');
    bigText += ` ${titlePlain} ${descPlain}`;
  });

  // 2) 간단 정규식으로 토큰 분할 (공백/특수문자 기준)
  const tokens = bigText.split(/[\s,.:\/"'()\[\]!?]+/).map(t => t.trim()).filter(Boolean);

  // 3) 카운트 객체
  const counts = {};
  tokens.forEach(token => {
    // 소문자로 처리하거나, 한글만 처리할 수도 있음
    // 여기서는 예시로 그대로
    if (!counts[token]) counts[token] = 0;
    counts[token]++;
  });

  // 4) "역", "동", "구", "스키장", "골프장", "대학교", "시청", "코엑스", "곤지암" 등 패턴
  //    혹은 ".*역$", ".*동$", ".*구$" 처럼 정규식을 응용
  const hotspotPatterns = [
    // 정규식 /.../ 형태
    /.+역$/,
    /.+동$/,
    /.+구$/,
    /.+로$/,
    /스키장$/,
    /골프장$/,
    /대학교$/,
    /시청$/,
    /코엑스/,
    /곤지암/
    // ... 필요한 패턴 추가
  ];

  // 5) 각 패턴에 매칭되는 토큰만 추출
  const resultMap = {};
  Object.entries(counts).forEach(([token, freq]) => {
    hotspotPatterns.forEach(pattern => {
      if (pattern.test(token)) {
        if (!resultMap[token]) resultMap[token] = 0;
        resultMap[token] += freq;
      }
    });
  });

  // 6) 빈도 수 내림차순
  // { '사당역': 10, '이수역': 5, '곤지암스키장': 3, ... }
  const sorted = Object.entries(resultMap)
    .sort((a, b) => b[1] - a[1])
    .map(([token, freq]) => ({ token, freq }));

  return sorted; // [{token:'사당역', freq:10}, ...]
}

/**
 * (C) 근처업체(경쟁사)에서 리뷰 더 가져오기 (블로그 많은 곳 위주)
 *  - 이 부분은 "지도 검색 API" 등으로 근처 업체를 조회 후,
 *    그중 블로그리뷰가 많을 것 같은 곳(예: 평점 높은 곳) 1~2개만 골라 재검색.
 */
async function getExtraBlogDataForNearby(placeInfo) {
  // (데모) 근처 업체 목록을 하드코딩 or 지도 API로 가져와서
  const nearPlaces = [
    { name: '근처 유명 고깃집1', blogKeyword: '근처 유명 고깃집1' },
    { name: '근처 인기 식당2', blogKeyword: '근처 인기 식당2' }
    // ... 실제론 거리 계산 & 평점/리뷰수 많은 순 정렬
  ];

  let extraData = [];
  for (const p of nearPlaces) {
    const items = await searchNaverBlog(p.blogKeyword, 10);
    extraData = extraData.concat(items);
  }
  return extraData;
}

/**
 * (D) 메인 함수
 * 1) 내 업체명으로 블로그 검색 → 텍스트 마이닝
 * 2) 리뷰 부족 시 → 근처 업체 블로그도 검색
 * 3) 최종 hotspots 추출 & 상위 n개 반환
 */
async function analyzeHotspotsByBlog(placeInfo) {
  const myQuery = placeInfo.name;  // 예: '예시고기집' 
  let blogData = await searchNaverBlog(myQuery, 30);

  // 만약 blogData가 너무 적으면(예: 5개 이하) 근처업체 리뷰도 추가
  if (blogData.length < 5) {
    const extraData = await getExtraBlogDataForNearby(placeInfo);
    blogData = blogData.concat(extraData);
  }

  // 텍스트 마이닝
  const sortedList = extractHotspotKeywords(blogData);

  // 상위 5개만 예시로 반환
  const top5 = sortedList.slice(0, 5);
  return top5;  // [{token:'사당역', freq:10}, ...]
}

module.exports = {
  searchNaverBlog,
  extractHotspotKeywords,
  getExtraBlogDataForNearby,
  analyzeHotspotsByBlog
};
