'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/config.json')[env];
const db = {};

// you'll require your model files after they've been properly exported
// For example:
// const Place = require('./Place');
// const Keyword = require('./Keyword');
// ...

// Because you specifically asked "index.js 파일만 수정해줄래?",
// just be aware the big issue is the "rank" keyword => "ranking".

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

// read other model files in the same folder
fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

// initialize associations
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// example association code (pseudocode, or you can place them after the models are defined)
const { Place, UserPlaceKeyword, Keyword, KeywordCrawl, KeywordCrawlResult } = db;

// place vs userPlaceKeywords
if (Place && UserPlaceKeyword) {
  Place.hasMany(UserPlaceKeyword, { foreignKey: 'place_id' });
  UserPlaceKeyword.belongsTo(Place, { foreignKey: 'place_id' });
}
// keyword vs userPlaceKeywords
if (Keyword && UserPlaceKeyword) {
  Keyword.hasMany(UserPlaceKeyword, { foreignKey: 'keyword_id' });
  UserPlaceKeyword.belongsTo(Keyword, { foreignKey: 'keyword_id' });
}
// keyword -> keywordCrawl
if (Keyword && KeywordCrawl) {
  Keyword.hasMany(KeywordCrawl, { foreignKey: 'keyword_id' });
  KeywordCrawl.belongsTo(Keyword, { foreignKey: 'keyword_id' });
}
// keywordCrawl -> keywordCrawlResults
if (KeywordCrawl && KeywordCrawlResult) {
  KeywordCrawl.hasMany(KeywordCrawlResult, { foreignKey: 'keyword_crawl_id' });
  KeywordCrawlResult.belongsTo(KeywordCrawl, { foreignKey: 'keyword_crawl_id' });
}

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
