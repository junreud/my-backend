import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import CustomerInfo from './CustomerInfo.js';

const ContactInfo = sequelize.define('ContactInfo', {
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
    comment: 'customer_info 테이블의 ID',
  },
  phone_number: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '전화번호',
  },
  contact_person: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '담당자명',
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
  tableName: 'contact_info',
  timestamps: false,
});

// 관계 설정
CustomerInfo.hasMany(ContactInfo, { foreignKey: 'customer_id' });
ContactInfo.belongsTo(CustomerInfo, { foreignKey: 'customer_id' });

export default ContactInfo;