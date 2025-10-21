import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const ReviewReplySettings = sequelize.define('ReviewReplySettings', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '사용자 ID'
  },
  place_id: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '네이버 플레이스 ID'
  },
  business_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '업체명'
  },
  tone: {
    type: DataTypes.STRING(100),
    defaultValue: 'friendly',
    comment: '답변 톤 (friendly, professional, warm, casual, formal)'
  },
  key_messages: {
    type: DataTypes.JSON,
    defaultValue: [],
    comment: '포함해야 할 핵심 메시지 배열'
  },
  avoid_words: {
    type: DataTypes.JSON,
    defaultValue: [],
    comment: '사용하지 말아야 할 단어/표현 배열'
  },
  template_content: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '기본 답변 템플릿'
  },
  auto_generate: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '자동 답변 생성 여부'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '설정 활성화 여부'
  }
}, {
  tableName: 'review_reply_settings',
  timestamps: true,
  paranoid: true, // soft delete
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'place_id']
    }
  ]
});

export default ReviewReplySettings;
