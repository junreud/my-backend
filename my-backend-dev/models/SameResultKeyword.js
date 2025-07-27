import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Keyword from './Keyword.js';

const SameResultKeyword = sequelize.define('SameResultKeyword', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  keyword_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'Keywords', key: 'id' }
  },
  related_keyword_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'Keywords', key: 'id' }
  }
}, {
  tableName: 'same_result_keywords',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['keyword_id', 'related_keyword_id'] }
  ]
});

// Associations
SameResultKeyword.belongsTo(Keyword, { foreignKey: 'keyword_id' });
SameResultKeyword.belongsTo(Keyword, { foreignKey: 'related_keyword_id', as: 'relatedKeyword' });

export default SameResultKeyword;
