// test/test.js
const { normalizePlaceUrl } = require('../services/normalizePlaceUrl');
const { getPlaceInfoFromUrl } = require('../services/placeInfoService');
const { getNearbyCompetitors } = require('../services/competitorService');

(async () => {
  try {
    // 예시 URL: 실제 테스트 시에는 입력받은 URL을 사용하세요.
    const inputUrl = 'https://map.naver.com/p/search/%EC%82%AC%EB%8B%B9%ED%9A%9F%EC%A7%91/place/1386862969?c=15.00,0,0,0,dh&placePath=%3Fentry%253Dbmp%2526n_ad_group_type%253D10%2526n_query%253D%2525EC%252582%2525AC%2525EB%25258B%2525B9%2525ED%25259A%25259F%2525EC%2525A7%252591';
    
    // 0) URL 정규화
    const normalizedUrl = await normalizePlaceUrl(inputUrl);
    if (!normalizedUrl) {
      console.error('[TEST] URL 정규화 실패');
      return;
    }
    console.log('[TEST] 정규화된 URL:', normalizedUrl);
    
    // 1) 업체 정보 추출
    const placeInfo = await getPlaceInfoFromUrl(normalizedUrl);
    if (!placeInfo) {
      console.error('[TEST] 업체 정보가 추출되지 않았습니다.');
      return;
    }
    console.log('[TEST] 추출된 업체 정보:', placeInfo);
  } catch (err) {
    console.error('[TEST] 에러 발생:', err);
  }
})();