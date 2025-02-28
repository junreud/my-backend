// controllers/keywordController.js (ESM)
import { normalizePlaceUrl } from '../services/normalizePlaceUrl.js';
import { getNaverPlaceFullInfo } from '../services/naverPlaceFullService.js';
import { analyzePlaceWithChatGPT } from '../services/chatGPTService.js';
import { fetchKeywordToolSlice } from '../services/naverAdApiService.js';

/**
 * [1] 최종 키워드 가져오기 (컨트롤러)
 * - 요청 파라미터로 URL을 받으면
 *   1) URL 정규화
 *   2) placeInfo 크롤링 (Puppeteer 등)
 *   3) ChatGPT로 업종·지역 키워드 30개 정도 뽑아냄
 *   4) 네이버 검색광고 API로 각 키워드의 검색량/경쟁도 등 조회
 *   5) (선택) 내부 스코어 계산 후 상위 20개만 추출
 */
export async function getFinalKeywords(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ message: 'url 파라미터가 필요합니다.' });
    }

    // 1) URL 정규화
    const normalizedUrl = await normalizePlaceUrl(url);
    if (!normalizedUrl) {
      return res.status(400).json({ message: 'URL을 정규화할 수 없습니다.' });
    }
    console.log(`[INFO] 정규화된 URL: ${normalizedUrl}`);

    // 2) placeInfo 크롤링
    const placeInfo = await getNaverPlaceFullInfo(normalizedUrl);
    if (!placeInfo) {
      console.warn('[WARN] placeInfo is null');
      return res.json({ success: true, data: [] });
    }

    // 3) ChatGPT로 키워드 후보군 추출
    const candidateKeywords = await analyzePlaceWithChatGPT(placeInfo);
    if (!candidateKeywords.length) {
      console.warn('[WARN] no candidate keywords from ChatGPT');
      return res.json({ success: true, data: [] });
    }

    // 4) 네이버 검색광고 API로 조회
    const externalDataList = await fetchKeywordToolSlice(candidateKeywords);
    // 예: [{ keyword, monthlySearchVolume, cpc, competition }, ...]

    const finalKeywords = await crawlTop10NaverResults(externalDataList);
    if (!asd.length){
      console.warn('[WARN] asd is null');
      return res.json({ seccess: true, data: [] });
    }

    // 원하는 형식대로 응답
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


/**
 * [2] 순위 데이터 가져오기
 */
export async function getRankingData(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ message: 'url 파라미터가 필요합니다.' });
    }

    // URL 정규화
    const normalizedUrl = await normalizePlaceUrl(url);
    if (!normalizedUrl) {
      return res.status(400).json({ message: 'URL을 정규화할 수 없습니다.' });
    }
    console.log(`[INFO] 정규화된 URL: ${normalizedUrl}`);

    // 서비스 로직
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
