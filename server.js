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
import { getDailySummary } from './controllers/statsController.js';
import bugReportRoutes from './routes/bugReportRoutes.js';

// Load queue worker to register processing handlers and schedules
import "./services/crawler/keywordQueue.js";

  const app = express();
  let server;

  // Always serve HTTPS with self-signed certificate in development and production
  const key = fs.readFileSync("./localhost+2-key.pem");
  const cert = fs.readFileSync("./localhost+2.pem");
  server = https.createServer({ key, cert }, app);

  // 허용된 도메인 정의
  const allowedOrigins = [
    'http://localhost:3000',
    'https://localhost:3000',
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

  // io를 전역으로 사용할 수 있도록 설정
  app.set('socketio', io);

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] 클라이언트 연결: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] 클라이언트 연결 종료: ${socket.id}`);
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
  app.use("/api/admin", adminRoutes);
  app.use("/api/customer", albamonRoutes);
  // 버그 리포트 API 및 업로드된 스크린샷 제공
  app.use('/api/bug-report', bugReportRoutes);
  app.use('/bug-report', bugReportRoutes);

  // 통계 API: 오늘의 사용자 및 신규 클라이언트 집계
  app.get(
    "/stats/daily-summary",
    passport.authenticate('jwt', { session: false }),
    getDailySummary
  );

// Redis 및 DB 연결
await connectRedis();
await sequelize.sync();
console.log("DB sync OK");

  const PORT = process.env.PORT || 4000;

  // Start HTTPS server
  server.listen(PORT, () => {
    console.log(`${process.env.NODE_ENV || 'server'} HTTPS server running on https://localhost:${PORT}`);
  });

  export { io };