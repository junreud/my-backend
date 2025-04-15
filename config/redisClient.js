// redisClient.js (ESM, "type": "module")
import 'dotenv/config';
import { createClient } from 'redis';

// 환경 변수 설정
const isDevelopment = process.env.NODE_ENV === 'development';

// 환경에 따른 Redis 설정
const getRedisConfig = () => {
  // 기본 설정
  const config = {
    socket: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
    }
  };

  // 비밀번호 설정이 있는 경우만 추가
  if (process.env.REDIS_PASSWORD) {
    config.password = process.env.REDIS_PASSWORD;
  }

  console.log(`[REDIS] 환경: ${isDevelopment ? '개발' : '배포'}`);
  console.log(`[REDIS] 연결 호스트: ${config.socket.host}:${config.socket.port}`);
  
  return config;
};

// createClient에 connection 옵션을 넘김
export const redisClient = createClient(getRedisConfig());

// 이 함수로 redis 연결 시도
export async function connectRedis() {
  redisClient.on('error', (err) => {
    console.error('Redis Client Error', err);
  });
  
  try {
    await redisClient.connect();
    console.log('Redis connected successfully');
  } catch (error) {
    console.error('Redis connection failed:', error);
    // 배포 환경에서는 Redis 연결 실패 시 서버 종료를 고려할 수 있음
    if (!isDevelopment) {
      console.error('Critical error in production: Redis connection failed');
      // process.exit(1); // 선택적으로 애플리케이션 종료 가능
    }
  }
}
