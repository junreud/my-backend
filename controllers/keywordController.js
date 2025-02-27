// ESM 버전 (keywordController.js 가정)

// 이미 ESM import로 교체하신 상태이므로 그대로 유지
import { normalizePlaceUrl } from '../services/normalizePlaceUrl.js';
import { getPlaceKeywordRanking } from '../services/keywordRankingService.js';
import { crawlPlaceAndFindMyRanking } from '../services/myRankingService.js';

/**
 * [1] 최종 키워드 가져오기
 */
export async function getFinalKeywords(req, res) {
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
    const topKeywords = await getPlaceKeywordRanking(normalizedUrl);

    return res.json({
      success: true,
      data: topKeywords,
    });
  } catch (err) {
    console.error('[ERROR] getKeywords:', err);
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
