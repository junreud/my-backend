// models/BrandingBlog.js
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const BrandingBlog = sequelize.define('BrandingBlog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  place_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: '네이버 플레이스 ID'
  },
  place_name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: '업체명'
  },
  blog_url: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: '브랜딩 블로그 URL (네이버 플레이스에서 등록된)'
  },
  blog_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: '블로그 ID (예: earlybirdgym)'
  },
  platform: {
    type: DataTypes.STRING,
    defaultValue: 'naver_blog',
    comment: '블로그 플랫폼 (naver_blog, instagram 등)'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '활성 상태'
  },
  last_crawled_at: {
    type: DataTypes.DATE,
    comment: '마지막 크롤링 시간'
  },
  crawl_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '총 크롤링 횟수'
  }
}, {
  tableName: 'branding_blogs',
  timestamps: true,
  paranoid: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
  indexes: [
    {
      fields: ['place_id']
    },
    {
      fields: ['blog_id']
    },
    {
      unique: true,
      fields: ['place_id', 'blog_url']
    }
  ]
});

export default BrandingBlog;
