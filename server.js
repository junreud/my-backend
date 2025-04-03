import fs from "fs"
import https from "https"
import express from "express"
import cors from "cors"
import sequelize from "./config/db.js"
import passport from "./middlewares/passport.js"
import morgan from "morgan"
import cookieParser from "cookie-parser"

import adminRoutes from "./routes/adminRoutes.js"
import authRoutes from "./routes/authRoutes.js"
import keywordRoutes from "./routes/keywordRoutes.js"
import userRoutes from "./routes/userRoutes.js"
import placeRoutes from "./routes/placeRoutes.js"
import { connectRedis } from "./config/redisClient.js"

// Express 앱 생성
const app = express()
let server;

// 환경에 따른 서버 생성
if (process.env.NODE_ENV === 'development') {
  // 개발 환경: HTTPS 직접 사용
  const key = fs.readFileSync("./localhost+2-key.pem")
  const cert = fs.readFileSync("./localhost+2.pem")
  server = https.createServer({ key, cert }, app)
} else {
  // 프로덕션 환경: Cloudflare Tunnel이 SSL을 처리하므로 Express 앱 그대로 사용
  server = app
}

// 전역 미들웨어
app.disable("etag");

app.use((req, res, next) => {
  console.log("[DEBUG] Incoming request:", req.method, req.url)
  res.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
  next()
})
app.use(morgan("dev"))

// CORS 설정 - 로컬과 cloudflare 도메인 모두 허용
const allowedOrigins = [
  'https://localhost:3000',
  'http://localhost:3000',
  'http://lakabe.com',
  'https://lakabe.com',
  'http://www.lakabe.com',
  'https://www.lakabe.com'
];

app.use(
  cors({
    origin: function(origin, callback) {
      // origin이 undefined인 경우 (예: Postman 요청, 서버 간 요청 등)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Origin ${origin} not allowed`);
        callback(null, true); // Cloudflare Tunnel 사용 시 다양한 출처를 허용하기 위해 true로 설정할 수도 있음
      }
    },
    credentials: true, // 쿠키 전송 허용
  })
)
app.use(cookieParser())
app.use(express.json())
app.use(passport.initialize())

// 라우트 등록 전에 글로벌 디버그 미들웨어 추가
app.use((req, res, next) => {
  console.log(`[SERVER DEBUG] 요청 접수: ${req.method} ${req.originalUrl}`);
  next();
});

// 라우트
app.use("/auth", authRoutes)
app.use("/keyword", keywordRoutes)
console.log("[SERVER] 키워드 라우터가 '/keyword' 경로에 마운트됨");
app.use("/api", userRoutes)
app.use("/api/place", placeRoutes);
app.use("/api/admin", adminRoutes)

// Redis 연결
await connectRedis()

// DB 연결 후 서버 구동
await sequelize.sync()
console.log("DB sync OK")

// 포트 설정 (환경 변수 또는 기본값)
const PORT = process.env.PORT || 4000;

// 서버 시작
if (process.env.NODE_ENV === 'development') {
  // 개발 환경: HTTPS 서버 시작
  server.listen(PORT, () => {
    console.log(`Development server running on https://localhost:${PORT}`)
  })
} else {
  // 프로덕션 환경: Express 앱 시작
  app.listen(PORT, () => {
    console.log(`Production server running on port ${PORT}`)
    console.log(`Available via Cloudflare Tunnel at http://lakabe.com`)
  })
}
