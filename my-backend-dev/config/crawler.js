import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../lib/logger.js';
const logger = createLogger('CrawlerConfig');

/* ---------------------------------------------
   1) Cookie + UA load functions
--------------------------------------------- */

/**
 * 지정된 최소/최대 시간(초) 사이에서 랜덤하게 대기
 * @param {number} minSec 최소 시간(초)
 * @param {number} maxSec 최대 시간(초)
 * @returns {Promise<void>}
 */
export async function randomDelay(minSec = 0.5, maxSec = 1.5) {
  const delayMs = Math.floor(Math.random() * (maxSec - minSec) * 1000) + minSec * 1000;
  logger.debug(`sleep ${delayMs}ms (약 ${(delayMs / 1000).toFixed(1)}초)`);
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

/**
 * 지정된 좌표 주변의 랜덤 좌표 생성 (미터 단위)
 * @param {number} baseX 기준 X 좌표 (경도)
 * @param {number} baseY 기준 Y 좌표 (위도)
 * @param {number} radiusM 반경(미터)
 * @returns {{randX: number, randY: number}} 랜덤 좌표
 */
export function getRandomCoords(baseX, baseY, radiusM = 300) {
  // 위도 1도 = 약 111km, 경도 1도는 위도에 따라 다름 (cos 함수로 보정)
  // 반경 내 랜덤한 위치 계산
  const angle = Math.random() * 2 * Math.PI; // 0~2π 사이 랜덤 각도
  const r = Math.sqrt(Math.random()) * radiusM; // 원 내부에 균등하게 분포하도록 sqrt 사용
  
  // 지구 반경 (미터)
  const earthRadius = 6371000;
  
  // 위도 1도 = 약 111km (미터당 변화량)
  const latPerMeter = 1 / 111000;
  
  // 경도 1도는 위도에 따라 다름
  const longPerMeter = 1 / (111000 * Math.cos(baseY * Math.PI / 180));
  
  // 미터 단위 변화량을 좌표 변화량으로 변환
  const latOffset = r * Math.sin(angle) * latPerMeter;
  const longOffset = r * Math.cos(angle) * longPerMeter;
  
  return {
    randX: baseX + longOffset,
    randY: baseY + latOffset
  };
}

export function loadMobileUAandCookies() {
  // 랜덤 선택 대신 고정 인덱스 사용 (1, 2, 3 중 원하는 번호로 설정)
  const fixedIndex = 3; // 항상 1번 쿠키 파일만 사용
  
  try {
    const dataPath = path.join(process.cwd(), `mobileNaverCookies_${fixedIndex}.json`);
    
    // 파일 존재 확인
    if (!fs.existsSync(dataPath)) {
      logger.warn(`쿠키 파일 없음: ${dataPath}, 기본 파일 사용`);
      // 기본 파일로 폴백
      const defaultPath = path.join(process.cwd(), 'mobileNaverCookies_1.json');
      const { ua, cookies } = JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      return { ua, cookieStr };
    }
    
    // 선택된 고정 파일 로드
    const { ua, cookies } = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    
    logger.debug(`[임시 설정] 고정된 쿠키 세트 #${fixedIndex} 사용 중`);
    return { ua, cookieStr };
  } catch (err) {
    logger.error(`쿠키 로드 오류: ${err.message}`);
    // 오류 발생 시 하드코딩된 기본값 반환
    return {
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      cookieStr: 'NNB=ABCDEF; nx_ssl=2'
    };
  }
}
/* ---------------------------------------------
   5) NAVER / other API keys + Proxy
--------------------------------------------- */
export const NAVER_LOCAL_CLIENT_ID = process.env.NAVER_LOCAL_CLIENT_ID;
export const NAVER_LOCAL_CLIENT_SECRET = process.env.NAVER_LOCAL_CLIENT_SECRET;
export const NAVER_MAP_CLIENT_ID = process.env.NAVER_MAP_CLIENT_ID;
export const NAVER_MAP_CLIENT_SECRET = process.env.NAVER_MAP_CLIENT_SECRET;

export const PROXY_SERVER = '';