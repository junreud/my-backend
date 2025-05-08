import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import CustomerInfo from './CustomerInfo.js';
import CustomerContactMap from './CustomerContactMap.js';

const ContactInfo = sequelize.define('ContactInfo', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
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
  // 블랙리스트 여부
  blacklist: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '블랙리스트 여부',
  },
  // 즐겨찾기 여부
  favorite: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '즐겨찾기 여부',
  },
  // friend_add_status: ENUM('pending', 'success', 'fail', 'already_registered')
  // 카톡 친구추가 상태
  friend_add_status: {
    type: DataTypes.ENUM('pending', 'success', 'fail', 'already_registered'),
    allowNull: false,
    defaultValue: 'pending',
    comment: '카톡 친구추가 상태',
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
CustomerInfo.belongsToMany(ContactInfo, {
  through: CustomerContactMap,
  foreignKey: 'customer_id',
  otherKey: 'contact_id',
});

ContactInfo.belongsToMany(CustomerInfo, {
  through: CustomerContactMap,
  foreignKey: 'contact_id',
  otherKey: 'customer_id',
});
export default ContactInfo;
