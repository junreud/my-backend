import sequelize from '../config/db.js';
import CustomerInfo from './CustomerInfo.js';
import ContactInfo from './ContactInfo.js';
import CustomerContactMap from './CustomerContactMap.js';
import KeywordBasicCrawlResult from './KeywordBasicCrawlResult.js';
import PlaceDetailResult from './PlaceDetailResult.js';
import Keyword from './Keyword.js';
import UserPlaceKeyword from './UserPlaceKeyword.js';
import WorkHistory from './WorkHistory.js';
import Place from './Place.js'; // Place 모델 추가
import Review from './Review.js';
import ReviewReplySettings from './ReviewReplySettings.js';
import SEOAnalysisResult from './SEOAnalysisResult.js';
// Add SameResultKeyword import
import SameResultKeyword from './SameResultKeyword.js';

// 관계 설정은 index.js에서만! (각 모델 파일에서는 제거)
CustomerInfo.belongsToMany(ContactInfo, {
  through: CustomerContactMap,
  foreignKey: 'customer_id',
  otherKey: 'contact_id',
});

ContactInfo.belongsToMany(CustomerInfo, {
  through: CustomerContactMap,
  foreignKey: 'contact_id',
  otherKey: 'customer_id',
});

KeywordBasicCrawlResult.hasOne(PlaceDetailResult, {
  foreignKey: 'place_id',
  sourceKey: 'place_id',
  constraints: false,
});

PlaceDetailResult.belongsTo(KeywordBasicCrawlResult, {
  foreignKey: 'place_id',
  targetKey: 'place_id',
  constraints: false,
});

Keyword.hasMany(KeywordBasicCrawlResult, {
  foreignKey: 'keyword_id',
  sourceKey: 'id',
});

KeywordBasicCrawlResult.belongsTo(Keyword, {
  foreignKey: 'keyword_id',
  targetKey: 'id',
});

// KeywordBasicCrawlResult와 Place 간의 관계 추가
KeywordBasicCrawlResult.belongsTo(Place, {
  foreignKey: 'place_id',
  targetKey: 'place_id',
  as: 'place'
});

Place.hasMany(KeywordBasicCrawlResult, {
  foreignKey: 'place_id',
  sourceKey: 'place_id'
});

// UserPlaceKeyword와 Keyword 간의 관계 추가
UserPlaceKeyword.belongsTo(Keyword, {
  foreignKey: 'keyword_id',
  targetKey: 'id'
});

Keyword.hasMany(UserPlaceKeyword, {
  foreignKey: 'keyword_id',
  sourceKey: 'id'
});

WorkHistory.belongsTo(UserPlaceKeyword, {
  foreignKey: { name: 'user_id', field: 'user_id' },
  targetKey: 'user_id',
  as: 'userPlaceKeyword',
  constraints: false,
});

WorkHistory.belongsTo(UserPlaceKeyword, {
  foreignKey: { name: 'place_id', field: 'place_id' },
  targetKey: 'place_id',
  as: 'userPlaceByPlace',
  constraints: false,
});

UserPlaceKeyword.hasMany(WorkHistory, {
  foreignKey: 'user_id',
  sourceKey: 'user_id',
  as: 'workHistories',
  constraints: false,
});

UserPlaceKeyword.hasMany(WorkHistory, {
  foreignKey: 'place_id',
  sourceKey: 'place_id',
  as: 'placeWorkHistories',
  constraints: false,
});

// Add associations for SameResultKeyword
Keyword.belongsToMany(Keyword, {
  through: SameResultKeyword,
  as: 'sameResultKeywords',
  foreignKey: 'keyword_id',
  otherKey: 'related_keyword_id',
  timestamps: false
});
Keyword.belongsToMany(Keyword, {
  through: SameResultKeyword,
  as: 'relatedToKeywords',
  foreignKey: 'related_keyword_id',
  otherKey: 'keyword_id',
  timestamps: false
});

// Review associations have been moved to the Review table itself
// All reply-related data is now stored directly in the reviews table

const db = {
  sequelize,
  CustomerInfo,
  ContactInfo,
  CustomerContactMap,
  KeywordBasicCrawlResult,
  PlaceDetailResult,
  Keyword,
  UserPlaceKeyword,
  WorkHistory,
  Place, // Place 모델 추가
  Review,
  ReviewReplySettings,
  // Export SameResultKeyword for use elsewhere
  SameResultKeyword
};

export { 
  sequelize, 
  CustomerInfo, 
  ContactInfo, 
  CustomerContactMap, 
  KeywordBasicCrawlResult, 
  PlaceDetailResult, 
  Keyword, 
  UserPlaceKeyword, 
  WorkHistory, 
  Place, 
  Review,
  ReviewReplySettings,
  SEOAnalysisResult,
  SameResultKeyword 
};

export default db;