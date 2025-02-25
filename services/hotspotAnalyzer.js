/**
 * services/hotspotAnalyzer.js
 */

// (가짜) 블로그 검색 API
async function getBlogTitlesForPlace(placeName, limit=100) {
    // 실제론 네이버 검색 API or Puppeteer
    // 여기서는 더미예시
    const dummyTitles = [
      `${placeName} 망원동 핫플 방문기`,
      `${placeName} 망원동 카페투어`,
      `망리단길 카페 리스트`,
      `맛있는 푸딩과 디저트`,
      `요즘 핫한 망리단길 데이트 코스`,
      // ...
    ];
    // 실제로는 limit=100개씩 가져옴
    return dummyTitles.slice(0, limit);
  }
  
  /**
   * 간단 정규식/토큰화로 "역","동","길" 등 패턴을 잡거나,
   * 형태소 분석기로 "망리단길" "망원동" 등 지역 키워드 추출
   */
  function extractHotspotsFromTitles(titles) {
    const text = titles.join(' ');
    // 간단 분할
    const tokens = text.split(/\s+/).map(t => t.trim()).filter(Boolean);
  
    // 카운트
    const freqMap = {};
    tokens.forEach(token => {
      // 여기서는 그냥 전부 카운트
      if (!freqMap[token]) freqMap[token] = 0;
      freqMap[token]++;
    });
    // 정렬
    const sorted = Object.entries(freqMap)
      .sort((a,b) => b[1] - a[1])
      .map(([word, count]) => ({ word, count }));
  
    return sorted;  // [{word:'망원동', count:2}, {word:'망리단길', count:1}...]
  }
  
  /**
   * 경쟁업체명으로 블로그리뷰 제목 100개 수집 -> 핫스팟 추출 -> 상위 n개
   */
  async function analyzeHotspots(competitor) {
    if (!competitor) {
      return []; // 경쟁업체가 없으면 빈 배열
    }
    // 1) 블로그 리뷰 제목 수집
    const titles = await getBlogTitlesForPlace(competitor.name, 100);
  
    // 2) 핫스팟 추출
    const hotspots = extractHotspotsFromTitles(titles);
    // 상위 5개만 예시
    return hotspots.slice(0, 5);
  }
  
  module.exports = {
    analyzeHotspots
  };
  