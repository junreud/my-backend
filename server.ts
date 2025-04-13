import fs from "fs";
import https from "https";
import http from "http";
import express, { Express } from "express";
import cors from "cors";
import sequelize from "./config/db";
import passport from "./middlewares/passport";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { Server as SocketIOServer, Socket } from 'socket.io';
import { connectRedis } from "./config/redisClient";
import albamonRoutes from "./routes/albamonRoutes";
import authRoutes from "./routes/authRoutes";
import keywordRoutes from "./routes/keywordRoutes";
import userRoutes from "./routes/userRoutes";
import placeRoutes from "./routes/placeRoutes";
import adminRoutes from "./routes/adminRoutes";

const app: Express = express();
let server: http.Server | https.Server;

const allowedOrigins: string[] = [
  'https://localhost:3000',
  'http://localhost:3000',
  'http://lakabe.com',
  'https://lakabe.com',
  'http://www.lakabe.com',
  'https://www.lakabe.com',
  'https://api.lakabe.com'
];

if (process.env.NODE_ENV === 'development') {
  const key = fs.readFileSync("./localhost+2-key.pem");
  const cert = fs.readFileSync("./localhost+2.pem");
  server = https.createServer({ key, cert }, app);
} else {
  server = http.createServer(app); // http 서버로 명시적으로 선언
}

const io: SocketIOServer = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  }
});

app.set('socketio', io);

io.on('connection', (socket: Socket) => {
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

// 비동기 초기화 함수
const initializeServer = async () => {
  await connectRedis();
  await sequelize.sync();
  console.log("DB sync OK");

  const PORT = process.env.PORT || 4000;

  server.listen(PORT, () => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`Development server running on https://localhost:${PORT}`);
    } else {
      console.log(`Production server running on port ${PORT}`);
      console.log(`Available via Cloudflare Tunnel at https://api.lakabe.com`);
    }
  });
};

initializeServer().catch(err => {
  console.error("Failed to initialize server:", err);
});

export { io };