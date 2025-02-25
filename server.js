const express = require('express');
const cors = require('cors');

//인스턴스
const passport = require('./config/passport'); 
const authRoutes = require('./routes/authRoutes');
const keywordRoutes = require('./routes/keywordRoutes');
const sequelize = require('./config/db');

const app = express();

app.use(cors(
  {
    origin: 'http://localhost:3000',
    credentials: true
  }
));
app.use(express.json());
app.use(passport.initialize());

// 라우트
app.use('/auth', authRoutes);
app.use('/keyword', keywordRoutes);

// DB 연결 + 서버 구동
sequelize.sync().then(() => {
  console.log('DB sync OK');
  app.listen(4000, () => console.log(`Server run on http://localhost:4000`));
});
