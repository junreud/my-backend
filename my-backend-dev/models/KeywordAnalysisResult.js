
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import CustomerInfo from './CustomerInfo.js';

const KeywordAnalysisResult = sequelize.define('KeywordAnalysisResult', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  customer_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    references: {
      model: CustomerInfo,
      key: 'id',
    },
    comment: '분석 대상 고객 ID',
  },
  keyword: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '추출된 키워드',
  },
  region: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '분석된 상권 또는 지역',
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'keyword_analysis_result',
  timestamps: false,
});

export default KeywordAnalysisResult;