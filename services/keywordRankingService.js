// services/keywordRankingService.js
const { getPlaceInfoFromUrl } = require('./placeInfoService');
const { aggregateTextsWithWeights } = require('./textAggregatorService');
const { tokenizeAndScore, getTopTokens } = require('./textMiningService');
const { getKeywordDataFromNaver } = require('./naverAdApiService');

/**
 * 1) placeUrl로부터 placeInfo 수집 (Puppeteer)
 * 2) textAggregator로 소개글, 리뷰제목, 메뉴명/설명 등 모아서 가중치 부여
 * 3) tokenizeAndScore 로 내부 점수 계산
 * 4) (선택) 상위 K개의 토큰에 대해 네이버 광고 API 검색량/경쟁도 조회
 * 5) 최종 점수 합산 (내부 점수 + 검색량 - CPC 등) 후 상위 20개 산출
 */
async function getPlaceKeywordRanking(placeUrl) {
  // 1) 크롤링
  const placeInfo = await getPlaceInfoFromUrl(placeUrl);
  if (!placeInfo) {
    console.warn('[WARN] placeInfo is null');
    return [];
  }

  // 2) 텍스트 모으기 + 가중치
  const textEntries = aggregateTextsWithWeights(placeInfo);
  // ex) [ { text, weight, type: "menuName" }, ...]

  // 3) tokenizeAndScore
  const { tokenScoreMap } = tokenizeAndScore(textEntries);
  // tokenScoreMap: { "사당역": 2.5, "고기집": 3.7, ... }

  // 4) 내부 점수 높은 상위 30개 정도만 후보로 삼아 네이버 광고 API를 조회 (예시)
  //    너무 많이 조회하면 API 비용/한도가 있을 수 있으므로, 적절히 제한
  const topTokens = getTopTokens(tokenScoreMap, 30); // [{ token, score }, ...]
  const candidateKeywords = topTokens.map(item => item.token);

  // 네이버 검색광고 API 조회
  const externalDataList = await getKeywordDataFromNaver(candidateKeywords);
  // [{ keyword, monthlySearchVolume, cpc, competition }, ...]

  // externalDataList 기준으로 맵 생성 (키: keyword)
  const externalMap = {};
  externalDataList.forEach(item => {
    externalMap[item.keyword] = item;
  });

  // 5) 최종 스코어 계산
  //   - 예시 공식: finalScore = (internalScore * 1.0) + (log(searchVolume)*1.5) - (competition*1.0) - (cpc*0.01)
  const finalArray = topTokens.map(({ token, score }) => {
    const ext = externalMap[token] || {};
    const searchVol = ext.monthlySearchVolume || 0;
    const cpc = ext.cpc || 0;
    const competition = ext.competition || 0;

    // 가중치 임의 예시
    const alpha = 1.0;
    const beta = 1.5;
    const gamma = 1.0;
    const delta = 0.01;

    const finalScore =
      score * alpha +
      (searchVol > 0 ? Math.log(searchVol) * beta : 0) -
      (competition * gamma) -
      (cpc * delta);

    return {
      keyword: token,
      internalScore: score,
      monthlySearchVolume: searchVol,
      cpc,
      competition,
      finalScore
    };
  });

  // 내림차순 정렬
  finalArray.sort((a, b) => b.finalScore - a.finalScore);

  // 상위 20개만 반환
  return finalArray.slice(0, 20);
}

module.exports = {
  getPlaceKeywordRanking
};
