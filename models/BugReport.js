import { Model, DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

class BugReport extends Model {}

BugReport.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  category: DataTypes.STRING,
  title: DataTypes.STRING,
  description: DataTypes.TEXT,
  screenshot_url: DataTypes.STRING,
  contact_phone: DataTypes.STRING,
  contact_email: DataTypes.STRING,
}, {
  sequelize,
  modelName: 'BugReport',
  tableName: 'BugReports',
});

export default BugReport;
