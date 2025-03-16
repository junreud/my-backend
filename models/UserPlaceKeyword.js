import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const UserPlaceKeyword = sequelize.define('UserPlaceKeyword', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
  },
  place_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
  },
  keyword_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
  },
  platform: {
    type: DataTypes.STRING(20),
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
  tableName: 'user_place_keywords',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'place_id', 'keyword_id'],
    },
  ],
});

export default UserPlaceKeyword;
