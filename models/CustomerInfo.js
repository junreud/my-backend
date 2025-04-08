import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const CustomerInfo = sequelize.define('CustomerInfo', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  posting_id: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    comment: '공고 ID (중복 금지)',
  },
  title: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: '공고 제목',
  },
  company_name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '업체명',
  },
  address: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '주소',
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
  tableName: 'customer_info',
  timestamps: false,
});

export default CustomerInfo;
