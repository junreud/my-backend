import db from './index.js';

const { sequelize } = db;

sequelize.sync({ alter: true })
  .then(() => {
    console.log('모든 테이블이 성공적으로 생성되었습니다!');
  })
  .catch((err) => {
    console.error('테이블 생성 중 오류 발생:', err);
  });