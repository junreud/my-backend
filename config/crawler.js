import 'dotenv/config';
import fs from 'fs';
import path from 'path';

/* ---------------------------------------------
   1) Cookie + UA load functions
--------------------------------------------- */

/**
 * Load the JSON file for "mobileNaverCookies.json",
 * returning { ua, cookieStr } to ensure consistency.
 */
export function loadMobileUAandCookies(index = 1) {
  const dataPath = path.join(process.cwd(), `mobileNaverCookies_${index}.json`);
  const { ua, cookies } = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { ua, cookieStr };
}

/* ---------------------------------------------
   3) Random coords
--------------------------------------------- */
export function getRandomCoords(baseX, baseY, radiusM = 300) {
  const distance = Math.random() * radiusM;
  const angle = Math.random() * 2 * Math.PI;
  const lat0Rad = (baseY * Math.PI) / 180;
  const deltaLat = (distance * Math.cos(angle)) / 111320;
  const deltaLng = (distance * Math.sin(angle)) / (111320 * Math.cos(lat0Rad));

  return {
    randY: baseY + deltaLat,
    randX: baseX + deltaLng,
  };
}

/* ---------------------------------------------
   4) Random delay (in seconds)
--------------------------------------------- */
export async function randomDelay(minSec = 0.1, maxSec = 4) {
  // (A) 0~(maxSec-minSec) 사이 난수 발생 → + minSec
  const randSec = Math.random() * (maxSec - minSec) + minSec;
  // (B) 소수점 첫째 자리까지 자르기
  const truncatedSec = Number(randSec.toFixed(1)); 
  // (C) 밀리초로 변환
  const ms = truncatedSec * 1000;

  console.log(`[DEBUG] sleep ${ms}ms (약 ${truncatedSec}초)`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ---------------------------------------------
   5) NAVER / other API keys + Proxy
--------------------------------------------- */
export const NAVER_LOCAL_CLIENT_ID = process.env.NAVER_LOCAL_CLIENT_ID;
export const NAVER_LOCAL_CLIENT_SECRET = process.env.NAVER_LOCAL_CLIENT_SECRET;
export const NAVER_MAP_CLIENT_ID = process.env.NAVER_MAP_CLIENT_ID;
export const NAVER_MAP_CLIENT_SECRET = process.env.NAVER_MAP_CLIENT_SECRET;

export const PROXY_SERVER = '';