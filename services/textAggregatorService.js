// services/textAggregatorService.js

/**
 * placeInfo 객체에서 필요한 텍스트를 모두 모아서
 * 각 텍스트에 가중치(weight)를 부여한다.
 * 
 * @param {Object} placeInfo
 *   {
 *     introduction, blogReviewTitles, menuList, ...
 *   }
 * @returns {Array} 
 *   e.g. [
 *     { text: "소개글 내용....", weight: 1.0, type: "introduction" },
 *     { text: "블로그 리뷰 제목1", weight: 1.2, type: "blogReview" },
 *     { text: "무한리필 소고기", weight: 1.5, type: "menuName" },
 *     { text: "신선한 한우...", weight: 1.2, type: "menuDescription" },
 *     ...
 *   ]
 */
function aggregateTextsWithWeights(placeInfo) {
  const results = [];

  // 소개글
  if (placeInfo.introduction) {
    results.push({
      text: placeInfo.introduction,
      weight: 1.0,
      type: 'introduction'
    });
  }

  // 블로그 리뷰제목
  if (placeInfo.blogReviewTitles && placeInfo.blogReviewTitles.length) {
    placeInfo.blogReviewTitles.forEach(title => {
      results.push({
        text: title,
        weight: 1.2,
        type: 'blogReview'
      });
    });
  }

  // 메뉴
  if (placeInfo.menuList && placeInfo.menuList.length) {
    placeInfo.menuList.forEach(menu => {
      // 메뉴명
      if (menu.name) {
        results.push({
          text: menu.name,
          weight: 1.5,
          type: 'menuName'
        });
      }
      // 메뉴 설명
      if (menu.description) {
        results.push({
          text: menu.description,
          weight: 1.2,
          type: 'menuDescription'
        });
      }
    });
  }

  return results;
}

module.exports = {
  aggregateTextsWithWeights
};
