/**
 * services/keywordComposer.js
 */

// hotspots: [{word:'망원동', count:5}, {word:'망리단길', count:3}, ...]
// menus: ['카페', '커피', '샌드위치', ...]
function combineHotspotAndMenu(hotspots, menus) {
  const combos = [];

  hotspots.forEach(h => {
    menus.forEach(m => {
      combos.push({
        keyword: `${h.word} ${m}`,
        baseScore: h.count // 예: 핫스팟 빈도를 baseScore로
      });
    });
  });
  return combos;
}

module.exports = {
  combineHotspotAndMenu
};
