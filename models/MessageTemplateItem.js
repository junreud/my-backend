import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import MessageTemplate from './MessageTemplate.js';

const MessageTemplateItem = sequelize.define('MessageTemplateItem', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  template_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    comment: '템플릿 ID',
  },
  order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '발송 순서',
  },
  type: {
    type: DataTypes.ENUM('text', 'image'),
    allowNull: false,
    comment: '메시지 타입',
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '텍스트 내용 또는 이미지 파일명',
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
  tableName: 'message_template_item',
  timestamps: false,
});

MessageTemplate.hasMany(MessageTemplateItem, { foreignKey: 'template_id', as: 'items' });
MessageTemplateItem.belongsTo(MessageTemplate, { foreignKey: 'template_id' });

export default MessageTemplateItem;