// crawlerAxios.js
import fetch from 'node-fetch';

/**
 * 상세 페이지 HTML 요청
 */
export async function fetchDetailHtml(placeId, cookieStr, userAgent, isRestaurantVal=false) {
    const route = isRestaurantVal ? 'restaurant' : 'place';
    const detailUrl = `https://m.place.naver.com/${route}/${placeId}/home`;
    
    // 타임아웃 설정 추가
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15초 타임아웃
    
    try {
      const res = await fetch(detailUrl, {
        method: 'GET',
        headers: {
          'Cookie': cookieStr,
          'User-Agent': userAgent,
        },
        signal: controller.signal // 타임아웃 신호 추가
      });
      
      clearTimeout(timeoutId); // 타임아웃 해제
      
      if (!res.ok) {
        throw new Error(`Failed to fetch detail for placeId=${placeId}: ${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      clearTimeout(timeoutId);
      // AbortError를 좀 더 의미있는 에러로 변환
      if (err.name === 'AbortError') {
        throw new Error(`Timeout: request for placeId=${placeId} took too long`);
      }
      throw err;
    }
  }

/**
 * HTML 파싱 (방문자리뷰, 블로그리뷰, keywordList)
 */
export function parseDetailHtml(html) {
  let visitorReviewCount = 0;
  let blogReviewCount = 0;
  let keywordList = [];

  // 메타태그 파싱 (예: 방문자리뷰 X,XXX / 블로그리뷰 X,XXX)
  const metaDescRegex = /<meta[^>]+property="og:description"[^>]+content="([^"]+)"[^>]*>/i;
  const metaMatch = html.match(metaDescRegex);
  if (metaMatch && metaMatch[1]) {
    const metaDesc = metaMatch[1].trim();

    const visitorMatch = metaDesc.match(/방문자리뷰\s+([\d,]+)/);
    if (visitorMatch) {
      visitorReviewCount = parseInt(visitorMatch[1].replace(/,/g, ''), 10);
    }
    const blogMatch = metaDesc.match(/블로그리뷰\s+([\d,]+)/);
    if (blogMatch) {
      blogReviewCount = parseInt(blogMatch[1].replace(/,/g, ''), 10);
    }
  }

  // window.__APOLLO_STATE__ 파싱
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (apolloMatch && apolloMatch[1]) {
    try {
      const apolloObj = JSON.parse(apolloMatch[1]);
      // DFS 찾아보기
      const foundList = findKeywordListDfs(apolloObj);
      if (Array.isArray(foundList)) {
        keywordList = foundList;
      }
    } catch (e) {
      console.warn('[WARN] parseDetailHtml JSON.parse 실패:', e);
    }
  }

  return {
    visitorReviewCount,
    blogReviewCount,
    keywordList
  };
}

/**
 * window.__APOLLO_STATE__ 내부에서 keywordList를 찾는 재귀 함수
 */
function findKeywordListDfs(obj) {
  if (!obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj.keywordList)) {
    return obj.keywordList;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object') {
      if (key === 'keywordList' && Array.isArray(value)) {
        return value;
      }
      const found = findKeywordListDfs(value);
      if (found) return found;
    }
  }
  return null;
}