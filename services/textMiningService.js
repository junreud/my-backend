// services/textMiningService.js

// 예시 불용어
const stopwords = ['그리고', '정말', '너무', '이런', '저런', '그런'];

/**
 * textEntries = [ { text, weight }, ... ] 를 받아서
 * (토큰별 점수) 맵을 만들어 반환
 * 
 * @param {Array} textEntries
 *   - ex) [ { text: "사당역 근처 가성비 좋은 고기집", weight: 1.0 }, ... ]
 * @returns {Object} 
 *   { tokenScoreMap, totalScore }
 *   - tokenScoreMap 예: { "사당역": 1.0, "고기집": 3.5, ... }
 */
function tokenizeAndScore(textEntries) {
  const tokenScoreMap = {};
  let totalScore = 0;

  textEntries.forEach(entry => {
    const { text, weight } = entry;
    if (!text || !weight) return;

    // 띄어쓰기 분리 (실제로는 형태소 분석 권장)
    const tokens = text.split(/\s+/);
    tokens.forEach(token => {
      const normalized = token.trim();
      if (!normalized) return;
      if (stopwords.includes(normalized)) return; // 불용어 제거
      if (normalized.length < 2) return; // 한 글자 토큰 제거 (예시)

      // 가중치만큼 점수 누적
      tokenScoreMap[normalized] = (tokenScoreMap[normalized] || 0) + weight;
      totalScore += weight;
    });
  });

  return { tokenScoreMap, totalScore };
}

/**
 * tokenScoreMap을 배열 형태로 정렬해서 상위 N개 토큰을 뽑는 헬퍼
 * @param {Object} tokenScoreMap - { token: score, ... }
 * @param {number} topN 
 */
function getTopTokens(tokenScoreMap, topN = 20) {
  const entries = Object.entries(tokenScoreMap); // [[token, score], ...]
  entries.sort((a, b) => b[1] - a[1]); // 내림차순
  return entries.slice(0, topN).map(([token, score]) => ({ token, score }));
}

module.exports = {
  tokenizeAndScore,
  getTopTokens
};
