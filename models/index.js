import KeywordBasicCrawlResult from './KeywordBasicCrawlResult.js';
import PlaceDetailResult from './PlaceDetailResult.js';  // 이름 변경
import Keyword from './Keyword.js';

// KeywordBasicCrawlResult와 PlaceDetailResult의 관계 재정의
KeywordBasicCrawlResult.hasOne(PlaceDetailResult, {
  foreignKey: 'place_id',
  sourceKey: 'place_id',
  constraints: false // 외래 키 제약조건 비활성화 (DB 스키마와 일치)
});

PlaceDetailResult.belongsTo(KeywordBasicCrawlResult, {
  foreignKey: 'place_id',
  targetKey: 'place_id',
  constraints: false // 외래 키 제약조건 비활성화 (DB 스키마와 일치)
});

// 키워드와의 관계
Keyword.hasMany(KeywordBasicCrawlResult, {
  foreignKey: 'keyword_id',
  sourceKey: 'id'
});

KeywordBasicCrawlResult.belongsTo(Keyword, {
  foreignKey: 'keyword_id',
  targetKey: 'id'
});

// Keyword와 PlaceDetailResult 사이의 직접적인 관계 제거
// (이제 place_id를 통해 간접적으로 연결됨)

export { 
  KeywordBasicCrawlResult, 
  PlaceDetailResult,  // 이름 변경 
  Keyword
};