const { normalizePlaceUrl } = require('../services/normalizePlaceUrl');
const { getPlaceKeywordRanking } = require('../services/keywordRankingService');

exports.getFinalKeywords = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ message: 'url 파라미터가 필요합니다.' });
    }

    // 0) URL 정규화
    const normalizedUrl = await normalizePlaceUrl(url);
    if (!normalizedUrl) {
      return res.status(400).json({ message: 'URL을 정규화할 수 없습니다.' });
    }
    console.log(`[INFO] 정규화된 URL: ${normalizedUrl}`);

    // 서비스 로직 호출
    const topKeywords = await getPlaceKeywordRanking(placeUrl);

    return res.json({
      success: true,
      data: topKeywords,
    });
  } catch (err) {
    console.error('[ERROR] getKeywords:', err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });}};