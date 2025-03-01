import { normalizePlaceUrl } from '../services/normalizePlaceUrl.js';
import { getNaverPlaceFullInfo } from '../services/naverPlaceFullService.js';
import { analyzePlaceWithChatGPT } from '../services/chatGPTService.js';
import { getSearchVolumes } from '../services/naverAdApiService.js';
import { crawlTop10NaverResults } from '../services/keywordGrounpingService.js';
import { crawlPlaceAndFindMyRanking } from '../services/crawlerService.js';


function getRandomCoords(baseX, baseY, radiusM = 300) {
  // radiusM 안에서 무작위 거리와 각도 생성
  const distance = Math.random() * radiusM; // 0 ~ radiusM
  const angle = Math.random() * 2 * Math.PI; // 0 ~ 2π

  // 위도 1도 ≈ 111,320m
  // 경도는 위도에 따라 다름 (cos(latitude))
  const lat0Rad = (baseY * Math.PI) / 180;

  const deltaLat = (distance * Math.cos(angle)) / 111320;
  const deltaLng =
    (distance * Math.sin(angle)) /
    (111320 * Math.cos(lat0Rad));

  // baseX(경도), baseY(위도)
  const randX = baseX + deltaLng;
  const randY = baseY + deltaLat;

  return { randX, randY };
}
export async function getFinalKeywords(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ 'req.query': req.query, message: 'url 파라미터가 필요합니다.' });
    }

    // 1) URL 정규화
    const normalizedUrl = await normalizePlaceUrl(url);
    if (!normalizedUrl) {
      return res.status(400).json({ message: 'URL을 정규화할 수 없습니다.' });
    }

    // 2) placeInfo 크롤링
    const placeInfo = await getNaverPlaceFullInfo(normalizedUrl);
    if (!placeInfo) {
      console.warn('[WARN] placeInfo is null');
      return res.json({ success: true, data: [] });
    }
    console.log('[INFO] 크롤링한 업체상세정보 =', JSON.stringify(placeInfo, null, 2));


    // 3) ChatGPT 분석
    const candidateKeywords = await analyzePlaceWithChatGPT(placeInfo);
    if (!candidateKeywords.length) {
      console.warn('[WARN] no candidate keywords from ChatGPT');
      return res.json({ success: true, data: [] });
    }
    console.log(`[INFO]ChatGPT가 분석한 키워드: ${candidateKeywords}`);

    // 4) 네이버 검색광고 API 조회
    const externalDataList = await getSearchVolumes(candidateKeywords);
    console.log('[INFO] 검색량 순 리스트 =', JSON.stringify(externalDataList, null, 2));

    // 5) 네이버 검색 결과(Top10)에서 뭔가를 크롤링
    const finalKeywords = await crawlTop10NaverResults(externalDataList);
    console.log(`[INFO] top 10 keyword: ${finalKeywords}`);
    
    return res.json({
      success: true,
      data: finalKeywords,
    });
  } catch (err) {
    console.error('[ERROR] getFinalKeywords:', err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}

export async function getRankingData(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ message: 'url 파라미터가 필요합니다.' });
    }

    const normalizedUrl = await normalizePlaceUrl(url);
    if (!normalizedUrl) {
      return res.status(400).json({ message: 'URL을 정규화할 수 없습니다.' });
    }
    console.log(`[INFO] 정규화된 URL: ${normalizedUrl}`);

    const myRanking = await crawlPlaceAndFindMyRanking(normalizedUrl);

    return res.json({
      success: true,
      data: myRanking,
    });
  } catch (err) {
    console.error('[ERROR] getMyRanking:', err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}

export default { 
  getFinalKeywords, 
  getRankingData 
};
