const { getPlaceInfoFromUrl } = require('../services/placeInfoService');


(async () => {
    try {
      // 1) 테스트할 네이버 플레이스 URL
      //    실제로는 네이버 지도에서 특정 장소의 PC버전 URL을 가져와 대입.
      const url = 'https://m.place.naver.com/restaurant/92093012/location?entry=pll&filter=location&selected_place_id=92093012';
  
      // 2) 함수 호출
      const placeInfo = await getPlaceInfoFromUrl(url);
  
      // 3) 결과 확인
      console.log('[TEST] placeInfo:', placeInfo);
  
      // 4) placeInfo가 정상적으로 데이터(예: { placeId, name, category, ... })를 반환했는지 확인
      if (!placeInfo) {
        console.error('[TEST] placeInfo is null or undefined');
      } else {
        console.log('[TEST] getPlaceInfoFromUrl 함수가 정상적으로 작동했습니다.');
      }
  
    } catch (err) {
      console.error('[TEST] 에러:', err);
    }
  })();