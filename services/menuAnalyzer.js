/**
 * services/menuAnalyzer.js
 */
async function analyzeMenuKeywords(placeInfo) {
    // placeInfo.category + 대표 메뉴... 
    // 여기서는 카페라면 ['카페','커피','디저트'] 정도로 가정
    if (placeInfo.category.includes('카페')) {
      return ['카페','커피','디저트'];
    } else if (placeInfo.category.includes('고기집')) {
      return ['고기집','삼겹살','돼지고기'];
    } else {
      return ['맛집','추천','음식'];
    }
  }
  
  module.exports = {
    analyzeMenuKeywords
  };
  