import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Keyword = sequelize.define('Keyword', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  keyword: {
    type: DataTypes.STRING(200),
    allowNull: false,
    unique: true,
  },
  basic_last_crawled_date: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  last_search_volume: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  isRestaurant: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
  },
  has_no_results: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false,
    comment: '"조건에 맞는 업체가 없습니다" 메시지가 표시되었는지 여부'
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
  tableName: 'keywords',
  timestamps: false,
});

export default Keyword;
