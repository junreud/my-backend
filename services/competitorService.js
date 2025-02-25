/**
 * services/competitorService.js
 *
 * - searchCompetitorsInDistance: (category, x, y, distanceMeters) → 근처 업체 리스트
 * - findCompetitor: distanceList 반복하여 '적절한' 경쟁업체 찾기
 */

// (간단 유클리드 거리 계산 예시; 실제론 haversine 공식 사용 권장)
function calcDistance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    // 여기서는 단순히 경도/위도로 유클리드 거리를 낸 뒤 * 100000 정도로 m 환산 (개념적)
    // 실제론 정교하게 구현 필요
    return Math.sqrt(dx*dx + dy*dy) * 100000;
  }
  
  // 가짜 데이터 예시
  const dummyCompetitors = [
    // placeId, name, category, x, y, reviewCount
    { placeId: 'C111', name: '망원동 또다른 카페', category: '카페', x: 126.9113, y: 37.5565, reviewCount: 30 },
    { placeId: 'C222', name: '망리단길 유명 카페', category: '카페', x: 126.9108, y: 37.5568, reviewCount: 72 },
    { placeId: 'C333', name: '홍대 베이글 카페',   category: '카페', x: 126.9234, y: 37.5569, reviewCount: 95 },
    { placeId: 'C444', name: '월드컵경기장 맛집',   category: '음식점', x: 126.9109, y: 37.5650, reviewCount: 10 }
  ];
  
  /**
   * 동일 업종(category) + distanceMeters 이내의 업체 목록
   * 실제로는 네이버 지도 API/DB 질의 등으로 구현
   */
  async function searchCompetitorsInDistance(category, x, y, distanceMeters) {
    // 더미데이터를 거리 필터 + 업종 필터
    return dummyCompetitors.filter(comp => {
      if (comp.category !== category) return false;
      const dist = calcDistance(x, y, comp.x, comp.y);
      return dist <= distanceMeters;
    });
  }
  
  /**
   * 거리 배수(100,200,400...) 확장하며
   * 1) 블로그리뷰≥50개인 업체 or
   * 2) 가장 리뷰 많은 업체
   * 를 찾는다
   */
  async function findCompetitor(category, x, y) {
    const distanceList = [100, 200, 400, 800, 1600, 3200];
    
    for (const dist of distanceList) {
      const comps = await searchCompetitorsInDistance(category, x, y, dist);
      if (comps.length === 0) continue;
  
      // 1) 리뷰≥50개
      let candidate = comps.find(c => c.reviewCount >= 50);
      if (!candidate) {
        // 없다면 reviewCount가 가장 큰 업체
        candidate = comps.reduce((prev, curr) => 
          (curr.reviewCount > prev.reviewCount ? curr : prev),
          comps[0]
        );
      }
      return candidate;  // 찾으면 즉시 반환
    }
    // 전부 없어도 null
    return null;
  }
  
  module.exports = {
    findCompetitor
  };
  