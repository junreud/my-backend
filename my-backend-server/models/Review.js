import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Review = sequelize.define('Review', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  place_id: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '네이버 플레이스 ID'
  },
  review_type: {
    type: DataTypes.ENUM('blog', 'receipt'),
    allowNull: false,
    comment: '리뷰 타입'
  },
  platform_type: {
    type: DataTypes.ENUM('blog', 'cafe', 'other'),
    allowNull: true,
    comment: '플랫폼 타입 (블로그, 카페, 기타)'
  },
  title: {
    type: DataTypes.STRING(500),
    comment: '리뷰 제목'
  },
  content: {
    type: DataTypes.TEXT,
    comment: '리뷰 내용'
  },
  author: {
    type: DataTypes.STRING(255),
    comment: '작성자'
  },
  review_date: {
    type: DataTypes.DATE,
    comment: '리뷰 작성일'
  },
  naver_review_id: {
    type: DataTypes.STRING(255),
    unique: true,
    comment: '네이버 리뷰 고유 ID (중복 방지용)'
  },
  images: {
    type: DataTypes.JSON,
    comment: '이미지 URL 배열'
  },
  url: {
    type: DataTypes.STRING(1000),
    comment: '원본 리뷰 URL'
  },
  has_owner_reply: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '사업자 답변 여부 (영수증 리뷰에서 사용)'
  },
  reply: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '사업자 답변 (AI 생성 또는 수동 작성)'
  },
  reply_date: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '답변 작성일'
  },
  reply_generated_by_ai: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false,
    comment: 'AI 생성 답변 여부'
  },
  reply_status: {
    type: DataTypes.ENUM('draft', 'published', 'edited'),
    allowNull: true,
    comment: '답변 상태 (초안, 게시됨, 편집됨)'
  },
  ai_generation_settings: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '답변 생성 시 사용된 AI 설정 (톤, 키워드 등)'
  },
  is_ad: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    comment: '광고글 여부 (블로그 리뷰에서 사용)'
  },
  ad_confidence: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '광고 판단 신뢰도 (0-100)'
  },
  ad_analysis_result: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '광고 분석 결과 상세 정보'
  },
  ad_analyzed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '광고 분석 실행 시간'
  }
}, {
  tableName: 'reviews',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['place_id', 'review_type']
    },
    {
      fields: ['review_date']
    },
    {
      fields: ['naver_review_id']
    }
  ]
});

export default Review;
