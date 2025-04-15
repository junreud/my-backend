import fs from "fs";
import https from "https";
import express from "express";
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

const app = express();
let server;

if (process.env.NODE_ENV === 'development') {
  const key = fs.readFileSync("./localhost+2-key.pem");
  const cert = fs.readFileSync("./localhost+2.pem");
  server = https.createServer({ key, cert }, app);
} else {
  server = app;
}

// 허용된 도메인 정의
const allowedOrigins = [
  // 개발 환경
  'http://localhost:3000',
  'https://localhost:3000',
  // 배포 환경
  FRONTEND_URL,
  'https://lakabe.com',
  'http://www.lakabe.com',
  'https://www.lakabe.com',
  'https://api.lakabe.com'
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

app.use("/auth", authRoutes);
app.use("/keyword", keywordRoutes);
app.use("/api", userRoutes);
app.use("/api/place", placeRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/customer", albamonRoutes);

// Redis 및 DB 연결
await connectRedis();
await sequelize.sync();
console.log("DB sync OK");

const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV === 'development') {
  server.listen(PORT, () => {
    console.log(`Development server running on https://localhost:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Production server running on port ${PORT}`);
    console.log(`Available via Cloudflare Tunnel at https://api.lakabe.com`);
  });
}

export { io };