import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const PlaceDetailResult = sequelize.define('PlaceDetailResult', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  place_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    unique: 'unique_place_id',
  },
  blog_review_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  receipt_review_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  keywordList: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  savedCount: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  last_crawled_at: { 
    type: DataTypes.DATE,
    allowNull: true,
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
  tableName: 'place_detail_results',
  timestamps: false,
});

export default PlaceDetailResult;
