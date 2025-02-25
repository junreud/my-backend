/**
 * services/searchVolumeService.js
 */
async function getSearchVolumeData(keywords) {
    // keywords: [{ keyword:'망원동 커피', baseScore:7 }, ... ]
    // 실제론 네이버 광고 API 호출
    // 여기선 가짜 값
    return keywords.map((item, idx) => ({
      keyword: item.keyword,
      baseScore: item.baseScore || 5,
      monthlySearchVolume: 1000 + (idx*100), // 예시
      competition: 20 + idx,                 // 예시
    }));
  }
  
  module.exports = {
    getSearchVolumeData
  };
  