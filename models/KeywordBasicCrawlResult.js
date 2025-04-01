import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const KeywordBasicCrawlResult = sequelize.define('KeywordBasicCrawlResult', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  keyword_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
  },
  ranking: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  place_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
  },
  category: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  place_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },

  last_crawled_at: {
    type: DataTypes.DATE,
    allowNull: true
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
  tableName: 'keyword_basic_crawl_results',
  timestamps: false,
});

export default KeywordBasicCrawlResult;
