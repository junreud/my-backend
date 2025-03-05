// services/keywordCombineService.js

/**
 * 카테고리에 따라 반드시 포함해야 할 업체특징 키워드를 추가하는 함수
 * - 예시: 헬스장 -> '헬스장', 마사지 -> '마사지', ...
 */
function enforceCategoryFeatures(category, featureKeywords) {
    const forcedMap = {
      '헬스장': '헬스장',
      '마사지': '마사지',
      '학원': '학원',
      '고기집': '고기집',
      '음식점': '맛집',    // 예시
      '술집': '술집',
      // 필요 시 더 추가...
    };
  
    // category가 forcedMap에 있으면, 해당 키워드를 featureKeywords에 포함
    const forced = forcedMap[category];
    if (forced && !featureKeywords.includes(forced)) {
      featureKeywords.push(forced);
    }
    // 주의: 실제 비즈니스 로직에 맞게 조정 필요
    return featureKeywords;
  }
  
  /**
   * locationKeywords × featureKeywords 조합하여
   * 최대 15개의 최종 키워드 배열을 만들고 반환
   */
  export function combineLocationAndFeatures({
    locationKeywords,
    featureKeywords,
    category,  // placeInfo.category
  }) {
    // 1) 카테고리에 따라 필수 키워드 삽입
    const updatedFeatures = enforceCategoryFeatures(category, [...featureKeywords]);
  
    // 2) 조합하기
    const combinedSet = new Set();  // 중복 방지용
  
    for (const loc of locationKeywords) {
      for (const feat of updatedFeatures) {
        // 주소만 / 특징만 단독이 아니라, "loc + feat" 식으로 합침
        // 예: "사당역헬스장"
        const keyword = loc + feat;
        combinedSet.add(keyword);
      }
    }
  
    // 3) 최대 15개만 사용
    const combinedArr = Array.from(combinedSet);
    const finalArr = combinedArr.slice(0, 15);
  
    return finalArr;
  }
  