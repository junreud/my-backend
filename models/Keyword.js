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
  last_crawled_date: {
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
