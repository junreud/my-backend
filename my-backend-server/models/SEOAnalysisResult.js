import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const SEOAnalysisResult = sequelize.define('SEOAnalysisResult', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  place_id: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '네이버 플레이스 ID',
    index: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '사용자 ID',
    index: true,
  },
  place_name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '업체명',
  },
  category: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '업종',
  },
  overall_score: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '전체 SEO 점수 (0-100)',
  },
  // SEO 개별 항목 점수들
  representative_photo_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '대표사진 점수',
  },
  business_info_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '업체정보 점수',
  },
  reservation_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '예약 점수',
  },
  talk_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '톡톡 점수',
  },
  coupon_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '쿠폰 점수',
  },
  notice_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '공지사항 점수',
  },
  business_hours_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '영업시간 점수',
  },
  menu_setting_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '메뉴설정 점수',
  },
  directions_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '찾아오는길 점수',
  },
  keywords_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '대표키워드 점수',
  },
  reviews_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '리뷰관리 점수',
  },
  // 분석 결과 상세 정보 (JSON)
  analysis_details: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'SEO 분석 상세 결과 (JSON)',
  },
  competitor_data: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '경쟁업체 분석 데이터 (JSON)',
  },
  recommendations: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '개선 권장사항 (JSON)',
  },
  analyzed_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '분석 수행 일시',
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'seo_analysis_results',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'idx_place_user',
      fields: ['place_id', 'user_id']
    },
    {
      name: 'idx_analyzed_at',
      fields: ['analyzed_at']
    }
  ]
});

export default SEOAnalysisResult;
