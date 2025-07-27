import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const MessageTemplate = sequelize.define('MessageTemplate', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '템플릿 이름',
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '설명',
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
  tableName: 'message_template',
  timestamps: false,
});

export default MessageTemplate;