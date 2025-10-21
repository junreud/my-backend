import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const CustomerContactMap = sequelize.define('CustomerContactMap', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  customer_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    comment: '연결된 업체 ID',
  },
  contact_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    comment: '연결된 연락처 ID',
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'customer_contact_map',
  timestamps: false,
});

export default CustomerContactMap;