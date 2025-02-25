/**
 * controllers/keywordController.js
 */
const { getPlaceInfoFromUrl } = require('../services/placeInfoService');
const { findCompetitor } = require('../services/competitorService');
const { analyzeMenuKeywords } = require('../services/menuAnalyzer');
const { analyzeHotspots } = require('../services/hotspotAnalyzer');
const { combineHotspotAndMenu } = require('../services/keywordComposer');
const { getSearchVolumeData } = require('../services/searchVolumeService');

exports.getFinalKeywords = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ message: 'url 파라미터가 필요합니다.' });
    }

    // 1) 업체 정보
    const placeInfo = await getPlaceInfoFromUrl(url);
    if (!placeInfo) {
      return res.status(404).json({ message: '업체 정보를 가져오지 못했습니다.' });
    }

    // 2) 근처 경쟁업체 찾기
    const competitor = await findCompetitor(placeInfo.category, placeInfo.x, placeInfo.y);

    // 3) 경쟁업체로부터 핫스팟 분석
    let hotspots = [];
    if (competitor) {
      hotspots = await analyzeHotspots(competitor);
    }
    // 만약 competitor가 없다면 hotspots는 []로 남음

    // 4) 업종(혹은 메뉴) 키워드 분석
    const menuKeywords = await analyzeMenuKeywords(placeInfo);

    // 5) 핫스팟 + 메뉴 조합
    const combos = combineHotspotAndMenu(hotspots, menuKeywords);
    if (combos.length === 0) {
      // 핫스팟이 전혀 없으면 카테고리만 있는 상태
      combos.push({ keyword: placeInfo.category, baseScore: 5 });
    }

    // 6) 검색량/경쟁도 가져오기
    const volumeData = await getSearchVolumeData(combos);

    // 7) 최종 점수 계산 (예: finalScore = baseScore + log(searchVolume+1) - competition*0.1)
    volumeData.forEach(item => {
      const { monthlySearchVolume, competition, baseScore } = item;
      const searchFactor = Math.log(monthlySearchVolume + 1);
      const compFactor = (competition + 1);
      const finalScore = baseScore + searchFactor - (compFactor * 0.1);
      item.finalScore = finalScore;
    });

    // 정렬 후 상위 5개
    volumeData.sort((a,b) => b.finalScore - a.finalScore);
    const topList = volumeData.slice(0,5);

    // 응답
    return res.json({
      placeInfo,
      competitor, // 선택된 경쟁업체 정보
      topKeywords: topList
    });

  } catch (err) {
    console.error('[ERROR] getFinalKeywords:', err);
    return res.status(500).json({ message: 'Server Error' });
  }
};
