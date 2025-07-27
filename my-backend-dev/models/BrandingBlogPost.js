// models/BrandingBlogPost.js
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import BrandingBlog from './BrandingBlog.js';

const BrandingBlogPost = sequelize.define('BrandingBlogPost', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  branding_blog_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: BrandingBlog,
      key: 'id'
    }
  },
  post_url: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: '블로그 글 URL'
  },
  title: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '블로그 글 제목'
  },
  content: {
    type: DataTypes.TEXT,
    comment: '블로그 글 내용'
  },
  author: {
    type: DataTypes.STRING,
    comment: '작성자'
  },
  published_at: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '글 작성 시간'
  },
  is_branding_post: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '브랜딩 포스트 여부'
  },
  search_check_status: {
    type: DataTypes.ENUM('pending', 'checking', 'found', 'not_found', 'missed'),
    defaultValue: 'pending',
    comment: '검색 확인 상태'
  },
  search_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '검색 시도 횟수'
  },
  first_search_at: {
    type: DataTypes.DATE,
    comment: '첫 번째 검색 시간 (작성 후 3시간)'
  },
  second_search_at: {
    type: DataTypes.DATE,
    comment: '두 번째 검색 시간 (작성 후 9시간)'
  },
  third_search_at: {
    type: DataTypes.DATE,
    comment: '세 번째 검색 시간 (작성 후 15시간)'
  },
  search_results: {
    type: DataTypes.JSON,
    comment: '검색 결과 저장 (각 시도별 결과)'
  },
  naver_ranking: {
    type: DataTypes.INTEGER,
    comment: '네이버 검색 결과 순위 (1-3위까지만, 없으면 null)'
  },
  is_ad: {
    type: DataTypes.BOOLEAN,
    comment: '광고 여부'
  },
  ad_confidence: {
    type: DataTypes.INTEGER,
    comment: '광고 신뢰도'
  }
}, {
  tableName: 'branding_blog_posts',
  timestamps: true,
  paranoid: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
  indexes: [
    {
      fields: ['branding_blog_id']
    },
    {
      fields: ['search_check_status']
    },
    {
      fields: ['published_at']
    },
    {
      unique: true,
      fields: ['post_url']
    },
    {
      fields: ['first_search_at']
    },
    {
      fields: ['second_search_at']
    },
    {
      fields: ['third_search_at']
    }
  ]
});

// 연관관계 설정
BrandingBlog.hasMany(BrandingBlogPost, {
  foreignKey: 'branding_blog_id',
  as: 'posts'
});

BrandingBlogPost.belongsTo(BrandingBlog, {
  foreignKey: 'branding_blog_id',
  as: 'brandingBlog'
});

export default BrandingBlogPost;
