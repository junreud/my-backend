import { normalizePlaceUrl } from '../services/normalizePlaceUrl.js';
import { getNaverPlaceFullInfo } from '../services/naverPlaceFullService.js';
import { analyzePlaceWithChatGPT } from '../services/chatGPTService.js';
import { getSearchVolumes } from '../services/naverAdApiService.js';
import { groupKeywordsByNaverTop10 } from '../services/keywordGrounpingService.js';
import { crawlPlaceAndFindMyRanking } from '../services/crawlerService.js';

// controllers/keywordController.js (예시)
export async function normalizeUrlHandler(req, res) {
  try {
    const { url } = req.query;  // or req.body
    if (!url) {
      return res.status(400).json({ success: false, message: 'url 파라미터가 필요합니다.' });
    }

    // (1) URL 정규화
    const normalizedUrl = await normalizePlaceUrl(url);
    if (!normalizedUrl) {
      return res
        .status(400)
        .json({ success: false, message: 'URL을 정규화할 수 없습니다.' });
    }

    // 정상 처리
    return res.json({
      success: true,
      normalizedUrl,
    });
  } catch (err) {
    console.error('[ERROR] normalizeUrlHandler:', err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}


export async function crawlAndAnalyzeHandler(req, res) {
  try {
    const { normalizedUrl } = req.body;
    if (!normalizedUrl) {
      return res.status(400).json({
        success: false,
        message: 'normalizedUrl이 필요합니다.',
      });
    }

    // 1) placeInfo 크롤링
    const placeInfo = await getNaverPlaceFullInfo(normalizedUrl);
    if (!placeInfo) {
      console.warn('[WARN] placeInfo is null');
      return res.json({ success: true, externalDataList: [] });
    }
    console.log('[INFO] 크롤링한 업체상세정보 =', JSON.stringify(placeInfo, null, 2));

    // 2) ChatGPT 분석
    const { locationKeywords, featureKeywords } = await analyzePlaceWithChatGPT(placeInfo);
    if (!locationKeywords.length && !featureKeywords.length) {
      console.warn('[WARN] no keywords from ChatGPT');
      return res.json({ success: true, externalDataList: [] });
    }
    console.log('[INFO] ChatGPT 분석결과');
    console.log(' locationKeywords:', locationKeywords);
    console.log(' featureKeywords:', featureKeywords);

    const candidateKeywords = combineLocationAndFeatures({
      locationKeywords,
      featureKeywords,
      category: placeInfo.category,
    });
    console.log('[INFO] 최종 후보 키워드 =', candidateKeywords);

    // 3) 네이버 검색광고 API 조회
    const externalDataList = await getSearchVolumes(candidateKeywords);
    console.log('[INFO] 검색량 조회 결과 =', JSON.stringify(externalDataList, null, 2));

    // 응답
    return res.json({
      success: true,
      externalDataList,
    });
  } catch (err) {
    console.error('[ERROR] crawlAndAnalyzeHandler:', err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}

function enforceCategoryFeatures(category, featureKeywords) {
  const forcedMap = {
    '헬스장': '헬스장, pt',
    '피부관리': '피부관리, 피부과',
    '네일샵': '네일샵, 속눈썹연장',
    '헤어샵': '헤어샵, 미용실',
    '요가': '요가, 필라테스',
    '마사지': '마사지, 발마사지, 스웨디시',
    '고기집': '고기집, 맛집',
    '베이커리': '베이커리, 빵집',
    '카페,디저트': '카페, 디저트',
    '술집': '술집, 안주맛집',
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
  category,
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
  const finalArr = combinedArr.slice(0, 100);

  return finalArr;
}

export async function groupKeywordsHandler(req, res) {
  try {
    const { externalDataList } = req.body;
    if (!externalDataList || !Array.isArray(externalDataList)) {
      return res.status(400).json({
        success: false,
        message: 'externalDataList(배열)가 필요합니다.',
      });
    }

    // 5) groupKeywordsByNaverTop10
    const finalKeywords = await groupKeywordsByNaverTop10(externalDataList);
    console.log('[INFO] groupKeywords 결과 =', JSON.stringify(finalKeywords, null, 2));

    return res.json({
      success: true,
      finalKeywords,
    });
  } catch (err) {
    console.error('[ERROR] groupKeywordsHandler:', err);
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
  normalizeUrlHandler,
  crawlAndAnalyzeHandler,
  groupKeywordsHandler, 
  getRankingData 
};
