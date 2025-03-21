import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const UserPlaceKeyword = sequelize.define('UserPlaceKeyword', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  place_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  keyword_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  timestamps: false,  // 타임스탬프 비활성화
  tableName: 'user_place_keywords'
});

export default UserPlaceKeyword;
