import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const KeywordCrawl = sequelize.define('KeywordCrawl', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  keyword_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
  },
  crawled_date: {
    type: DataTypes.DATE,
    allowNull: false,
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
  tableName: 'keyword_crawls',
  timestamps: false,
});

export default KeywordCrawl;
