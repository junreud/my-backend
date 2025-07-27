import { Model, DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

class SystemLog extends Model {}

SystemLog.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  level: {
    type: DataTypes.ENUM('debug', 'info', 'warn', 'error'),
    allowNull: false
  },
  logger: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  details: {
    type: DataTypes.JSON,
    allowNull: true
  },
  service: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  sequelize,
  modelName: 'SystemLog',
  tableName: 'systemlogs',
  timestamps: false,
  indexes: [
    { fields: ['timestamp'] },
    { fields: ['level'] },
    { fields: ['logger'] },
    { fields: ['service'] }
  ]
});

export default SystemLog;