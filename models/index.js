import KeywordBasicCrawlResult from './KeywordBasicCrawlResult.js';
import PlaceDetailResult from './PlaceDetailResult.js';
import Keyword from './Keyword.js';
import UserPlaceKeyword from './UserPlaceKeyword.js';
import WorkHistory from './WorkHistory.js';

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

// WorkHistory와 UserPlaceKeyword 관계 설정
WorkHistory.belongsTo(UserPlaceKeyword, { 
  foreignKey: { name: 'user_id', field: 'user_id' },
  targetKey: 'user_id',
  as: 'userPlaceKeyword',
  constraints: false
});

WorkHistory.belongsTo(UserPlaceKeyword, {
  foreignKey: { name: 'place_id', field: 'place_id' },
  targetKey: 'place_id',
  as: 'userPlaceByPlace',
  constraints: false
});

UserPlaceKeyword.hasMany(WorkHistory, {
  foreignKey: 'user_id',
  sourceKey: 'user_id',
  as: 'workHistories',
  constraints: false
});

UserPlaceKeyword.hasMany(WorkHistory, {
  foreignKey: 'place_id',
  sourceKey: 'place_id',
  as: 'placeWorkHistories',
  constraints: false
});

export { 
  KeywordBasicCrawlResult, 
  PlaceDetailResult,
  Keyword,
  WorkHistory,
  UserPlaceKeyword
};