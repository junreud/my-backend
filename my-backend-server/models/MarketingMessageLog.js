import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import CustomerInfo from './CustomerInfo.js';
import ContactInfo from './ContactInfo.js';
import KeywordAnalysisResult from './KeywordAnalysisResult.js';
import KeywordCapture from './KeywordCapture.js';

const MarketingMessageLog = sequelize.define('MarketingMessageLog', {
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
  },
  contact_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    references: {
      model: ContactInfo,
      key: 'id',
    },
  },
  keyword_analysis_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: true,
    references: {
      model: KeywordAnalysisResult,
      key: 'id',
    },
  },
  capture_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: true,
    references: {
      model: KeywordCapture,
      key: 'id',
    },
  },
  message_content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '보낸 메시지 본문',
  },
  sent_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  status: {
    type: DataTypes.ENUM('success', 'failed', 'throttled'),
    defaultValue: 'pending',
  },
}, {
  tableName: 'marketing_message_log',
  timestamps: false,
});

export default MarketingMessageLog;