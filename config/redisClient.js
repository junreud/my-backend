// redisClient.js (ESM, "type": "module")
// .env에서 REDIS_HOST, REDIS_PORT, REDIS_PASSWORD 등을 읽어온다고 가정
import 'dotenv/config';
import { createClient } from 'redis';

const redisUrl = {
  socket: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
  },
  // password가 필요한 경우
  password: process.env.REDIS_PASSWORD ?? undefined,
};

// createClient에 connection 옵션을 넘김
export const redisClient = createClient(redisUrl);

// 이 함수로 redis 연결 시도
export async function connectRedis() {
  redisClient.on('error', (err) => {
    console.error('Redis Client Error', err);
  });
  await redisClient.connect(); 
  console.log('Redis connected');
}
