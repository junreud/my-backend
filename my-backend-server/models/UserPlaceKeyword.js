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
  },
  isMain: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '메인 키워드 여부 (가장 높은 검색량)'
  }
}, {
  timestamps: false,  // 타임스탬프 비활성화
  tableName: 'user_place_keywords'
});

// 모델 관계 설정
UserPlaceKeyword.associate = (models) => {
  UserPlaceKeyword.belongsTo(models.Keyword, {
    foreignKey: 'keyword_id',
    as: 'Keyword'
  });
};

export default UserPlaceKeyword;
