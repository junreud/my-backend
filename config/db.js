// config/db.js
require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,         // DB 이름
  process.env.DB_USER,         // DB 유저
  process.env.DB_PASS,         // DB 비밀번호
  {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false, // 콘솔에 SQL문 출력 여부
  }
);

module.exports = sequelize;
