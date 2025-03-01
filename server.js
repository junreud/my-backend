console.log('=== Start server.js ===');

import express from 'express';
import cors from 'cors';
import sequelize from './config/db.js';
import passport from './config/passport.js';

import authRoutes from './routes/authRoutes.js';
import keywordRoutes from './routes/keywordRoutes.js';

const app = express();

// 전역 미들웨어로 모든 요청 로깅
app.use((req, res, next) => {
  console.log('[DEBUG] Incoming request:', req.method, req.url);
  next();
});


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
