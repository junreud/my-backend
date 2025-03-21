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
  detail_last_crawled_date: {
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
  basic_crawled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  detail_crawled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
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
