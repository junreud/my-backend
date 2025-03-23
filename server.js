import fs from "fs"
import https from "https"
import express from "express"
import cors from "cors"
import sequelize from "./config/db.js"
import passport from "./middlewares/passport.js"
import morgan from "morgan"
import cookieParser from "cookie-parser"

import authRoutes from "./routes/authRoutes.js"
import keywordRoutes from "./routes/keywordRoutes.js"
import userRoutes from "./routes/userRoutes.js"
import placeRoutes from "./routes/placeRoutes.js"
import { connectRedis } from "./config/redisClient.js"
import { startScheduler } from './services/schedulerService.js'

// (1) HTTPS 인증서 읽기
const key = fs.readFileSync("./localhost+2-key.pem")
const cert = fs.readFileSync("./localhost+2.pem")

// (2) Express 앱 + HTTPS 서버 생성
const app = express()
const server = https.createServer({ key, cert }, app)

// 전역 미들웨어
app.disable("etag");

app.use((req, res, next) => {
  console.log("[DEBUG] Incoming request:", req.method, req.url)

  res.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
  next()
})
app.use(morgan("dev"))
app.use(
  cors({
    origin: "https://localhost:3000", // 프론트도 https://localhost:3000 으로 접근해야 함
    credentials: true, // 쿠키 전송 허용
  })
)
app.use(cookieParser())
app.use(express.json())
app.use(passport.initialize())

// 라우트
app.use("/auth", authRoutes)
app.use("/keyword", keywordRoutes)
app.use("/api", userRoutes)
app.use("/api/place", placeRoutes); // 원래대로 /api/place 유지

// Redis 연결
await connectRedis()

// DB 연결 후 서버 구동
await sequelize.sync()
console.log("DB sync OK")
// 서버 시작 시 스케줄러 초기화
startScheduler()

// (3) HTTPS 서버 시작
server.listen(4000, () => {
  console.log("Server run on https://localhost:4000")
})
