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
  naverplace_url: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '네이버 플레이스 URL',
  },
  source_filter: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '데이터 소스 또는 필터 정보'
  },
  created_at: { // Sequelize가 내부적으로 인식하는 이름
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'customer_info',
  timestamps: true, // Sequelize가 자동 관리하도록 true로 변경 (추천)
  underscored: true // DB 컬럼명 snake_case로 관리
});
export default CustomerInfo;
