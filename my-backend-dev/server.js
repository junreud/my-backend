import fs from "fs";
import https from "https";
import express from "express";
import path from "path";
import cors from "cors";
import sequelize from "./config/db.js";
import passport from "./middlewares/passport.js";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { Server } from 'socket.io';
import { connectRedis } from "./config/redisClient.js";
import albamonRoutes from "./routes/albamonRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import keywordRoutes from "./routes/keywordRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import placeRoutes from "./routes/placeRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import kakaoRoutes from "./routes/kakaoRoutes.js";
import templateRoutes from './routes/templateRoutes.js';
import { getDailySummary, getDashboardRankingData } from './controllers/statsController.js';
import bugReportRoutes from './routes/bugReportRoutes.js';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import createLogger from './lib/logger.js';
import { asyncHandler, authenticateJWT } from './middlewares/auth.js';
import notificationRoutes from './routes/notificationRoutes.js';
import reviewRoutes from "./routes/reviewRoutes.js";
import reviewReplyRoutes from "./routes/reviewReplyRoutes.js";
import seoRoutes from "./routes/seoRoutes.js";
import workHistoryRoutes from "./routes/workHistoryRoutes.js";
import Review from './models/Review.js';
import NaverReviewCrawler from './services/naverReviewCrawler.js';
import cron from 'node-cron';

import { startBrandingBlogScheduler } from './scripts/brandingBlogScheduler.js';

  const app = express();
  const logger = createLogger('server');
  let server;

  // Always serve HTTPS with self-signed certificate in development and production
  const key = fs.readFileSync("./localhost+2-key.pem");
  const cert = fs.readFileSync("./localhost+2.pem");
  server = https.createServer({ key, cert }, app);

  // 허용된 도메인 정의
  const frontendPort = process.env.FRONTEND_PORT || '3000';
  const allowedOrigins = [
    `http://localhost:${frontendPort}`,
    `https://localhost:${frontendPort}`,
    process.env.FRONTEND_URL,
    'https://lakabe.com',
    'https://www.lakabe.com',
  ];

  // Socket.IO 초기화
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    }
  });

  // Socket.IO 인증: Authorization header or auth token via handshake.auth
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token ||
        (socket.handshake.headers.authorization || '').split(' ')[1];
      if (!token) throw new Error('No token');
      const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      const user = await User.findByPk(payload.userId);
      if (!user) throw new Error('Invalid user');
      socket.join(`user_${user.id}`);
      next();
    } catch (err) {
      logger.error('[Socket.IO] auth error:', err.message);
      next(new Error('Unauthorized'));
    }
  });

  // io를 전역으로 사용할 수 있도록 설정
  app.set('socketio', io);

  // reviewController에 Socket.IO 인스턴스 전달
  const { setSocketIO } = await import('./controllers/reviewController.js');
  setSocketIO(io);

  io.on('connection', (socket) => {
    logger.info(`[Socket.IO] 클라이언트 연결: ${socket.id}`);

    socket.on('disconnect', () => {
      logger.info(`[Socket.IO] 클라이언트 연결 종료: ${socket.id}`);
    });
  });

  app.disable("etag");
  app.use(morgan("dev"));
  app.use(cors({
    origin: allowedOrigins,
    credentials: true,
  }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(passport.initialize());

  // 정적 파일 제공 설정 추가
  app.use('/uploads/bug_screenshots', express.static(path.join(process.cwd(), 'uploads/bug_screenshots')));

  app.use("/auth", authRoutes);
  app.use("/keyword", keywordRoutes);

  // 템플릿 디렉토리 브라우징 및 API (특정경로 먼저 매칭)
  app.use('/api/templates', templateRoutes);
  // 사용자 관련 API
  app.use("/api", userRoutes);
  app.use("/api/place", placeRoutes);
  app.use("/api/reviews", reviewRoutes);
  app.use("/api/review-reply", reviewReplyRoutes);
  app.use("/api/seo", seoRoutes);
  app.use("/api/work-history", workHistoryRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/customer", albamonRoutes);
  app.use("/api/kakao", kakaoRoutes);
  // 버그 리포트 API 및 업로드된 스크린샷 제공
  app.use('/api/bug-report', bugReportRoutes);
  app.use('/bug-report', bugReportRoutes);

  // 통계 API: 오늘의 사용자 및 신규 클라이언트 집계
  app.use(
    "/stats/daily-summary",
    authenticateJWT,
    asyncHandler(getDailySummary)
  );
  
  // 대시보드 순위 변화 데이터 API
  app.get(
    "/api/stats/dashboard-ranking",
    authenticateJWT,
    asyncHandler(getDashboardRankingData)
  );
  // 알림 API
  app.use('/api/notifications', notificationRoutes);
  
  // 크롤링 테스트 엔드포인트 (개발/관리자용)
  app.post('/api/admin/trigger-crawling', authenticateJWT, asyncHandler(async (req, res) => {
    try {
      logger.info('[MANUAL TRIGGER] 수동 크롤링 트리거 요청됨');
      const { autoCheckAndAddBasicJobs } = await import('./services/crawler/keywordQueue.js');
      await autoCheckAndAddBasicJobs();
      res.json({ 
        success: true, 
        message: '크롤링 작업이 큐에 추가되었습니다.' 
      });
    } catch (error) {
      logger.error('[MANUAL TRIGGER] 수동 크롤링 트리거 실패:', error.message);
      res.status(500).json({ 
        success: false, 
        message: '크롤링 트리거 중 오류가 발생했습니다.' 
      });
    }
  }));
  
  // 404 Not Found 핸들러
  app.use((req, res) => {
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ success: false, message: 'Not Found' });
  });

  // 전역 에러 핸들러
  app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({ success: false, message: err.message || 'Internal Server Error' });
  });

  /**
 * 자동 리뷰 크롤링 함수
 * 모든 등록된 place_id에 대해 리뷰 크롤링 실행
 */
async function autoReviewCrawling() {
  try {
    // 1. 등록된 모든 고유한 place_id 조회
    const distinctPlaceIds = await Review.findAll({
      attributes: ['place_id'],
      group: ['place_id'],
      raw: true
    });

    if (distinctPlaceIds.length === 0) {
      logger.info('[SCHEDULER] 크롤링할 place_id가 없습니다.');
      return;
    }

    logger.info(`[SCHEDULER] 총 ${distinctPlaceIds.length}개 업체의 리뷰 크롤링 시작`);

    const crawler = new NaverReviewCrawler();
    let successCount = 0;
    let failureCount = 0;

    // 2. 각 place_id에 대해 리뷰 크롤링 실행
    for (const { place_id } of distinctPlaceIds) {
      try {
        logger.info(`[SCHEDULER] 리뷰 크롤링 시작: ${place_id}`);
        
        const crawlResult = await crawler.crawlAndSaveReviews(place_id, {
          reviewType: 'receipt', // 영수증 리뷰
          maxPages: 3 // 최대 3페이지
        });

        logger.info(`[SCHEDULER] 리뷰 크롤링 완료: ${place_id}, 저장된 리뷰: ${crawlResult.saved}개`);
        successCount++;

        // 각 크롤링 사이에 1초 지연 (서버 부하 방지)
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        logger.error(`[SCHEDULER] 리뷰 크롤링 실패: ${place_id}`, error.message);
        failureCount++;
      }
    }

    logger.info(`[SCHEDULER] 리뷰 크롤링 완료 - 성공: ${successCount}, 실패: ${failureCount}`);

  } catch (error) {
    logger.error('[SCHEDULER] 자동 리뷰 크롤링 중 오류:', error.message);
    throw error;
  }
}

/**
 * 매일 15:00에 자동으로 리뷰 크롤링 실행
 */
function setupReviewCrawlingScheduler() {
  logger.info('[SCHEDULER] 리뷰 크롤링 스케줄러 설정 중...');
  
  // 매일 15:00에 자동 리뷰 크롤링 실행 (키워드 크롤링 1시간 후)
  cron.schedule('0 15 * * *', async () => {
    try {
      logger.info('[SCHEDULER] 15:00 자동 리뷰 크롤링 시작...');
      await autoReviewCrawling();
      logger.info('[SCHEDULER] 15:00 자동 리뷰 크롤링 완료');
    } catch (error) {
      logger.error('[SCHEDULER] 15:00 자동 리뷰 크롤링 실행 중 오류:', error.message);
    }
  }, {
    timezone: "Asia/Seoul"
  });
  
  // 개발환경에서는 추가로 매 2시간마다 테스트 실행 - 비활성화 (프론트엔드에서 처리)
  // if (process.env.NODE_ENV === 'development') {
  //   cron.schedule('0 0/2 * * *', async () => {
  //     try {
  //       logger.info('[SCHEDULER] [DEV] 2시간마다 자동 리뷰 크롤링 테스트 시작...');
  //       await autoReviewCrawling();
  //       logger.info('[SCHEDULER] [DEV] 2시간마다 자동 리뷰 크롤링 테스트 완료');
  //     } catch (error) {
  //       logger.error('[SCHEDULER] [DEV] 2시간마다 자동 리뷰 크롤링 테스트 중 오류:', error.message);
  //     }
  //   }, {
  //     timezone: "Asia/Seoul"
  //   });
  // }
  
  
  logger.info('[SCHEDULER] 리뷰 크롤링 스케줄러 설정 완료');
  logger.info('[SCHEDULER] - 매일 15:00 (KST)에 자동 리뷰 크롤링 실행');
  // 개발환경 자동 크롤링 비활성화됨 - 프론트엔드에서 처리
  // if (process.env.NODE_ENV === 'development') {
  //   logger.info('[SCHEDULER] - [DEV] 매 2시간마다 테스트 리뷰 크롤링 실행');
  // }
}

// Redis 및 DB 연결
await connectRedis();
await sequelize.sync();
logger.info("DB sync OK");

// 리뷰 크롤링 스케줄러 설정
setupReviewCrawlingScheduler();

// 브랜딩 블로그 검색 스케줄러 시작
startBrandingBlogScheduler();

// 포트 설정: 명령어 인자 > 환경 변수 > 기본값(4000)
const args = process.argv.slice(2);
const portArg = args.find(arg => arg.startsWith('-p') || arg.startsWith('--port'));
let PORT = 4000;

if (portArg) {
  if (portArg.includes('=')) {
    PORT = parseInt(portArg.split('=')[1]);
  } else {
    const portIndex = args.indexOf(portArg);
    PORT = parseInt(args[portIndex + 1]);
  }
} else if (process.env.PORT) {
  PORT = parseInt(process.env.PORT);
}

// Health check 엔드포인트 (포트 자동 감지용)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Start HTTPS server
server.listen(PORT, () => {
  logger.info(`${process.env.NODE_ENV || 'server'} HTTPS server running on https://localhost:${PORT}`);
});

  export { io };