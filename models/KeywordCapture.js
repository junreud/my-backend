import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import KeywordAnalysisResult from './KeywordAnalysisResult.js';

const KeywordCapture = sequelize.define('KeywordCapture', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  keyword_analysis_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    references: {
      model: KeywordAnalysisResult,
      key: 'id',
    },
    comment: '분석 결과 ID',
  },
  image_path: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: '캡처 이미지 경로',
  },
  captured_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'keyword_capture',
  timestamps: false,
});

export default KeywordCapture;
