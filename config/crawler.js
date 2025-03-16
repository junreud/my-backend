// crawler.js (ESM version)
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
export function loadMobileUAandCookies() {
  const dataPath = path.join(process.cwd(), 'mobileNaverCookies.json');
  const { ua, cookies } = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { ua, cookieStr };
}

/**
 * Same for "pcNaverCookies.json"
 */
export function loadPcUAandCookies() {
  const dataPath = path.join(process.cwd(), 'pcNaverCookies.json');
  const { ua, cookies } = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { ua, cookieStr };
}

/* ---------------------------------------------
   2) "Pick mobile vs pc" or random approach
--------------------------------------------- */
function isMobileUA(ua) {
  const lower = ua.toLowerCase();
  return lower.includes('mobile') || lower.includes('android') || lower.includes('iphone');
}

/**
 * If you want to pick a random type each time, or choose dynamically.
 * For example: "We have 2 cookie files. We'll decide which to load."
 */
export function getUAandCookiesMobileOrPc(wantMobile = true) {
  if (wantMobile) {
    return loadMobileUAandCookies();
  } else {
    return loadPcUAandCookies();
  }
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
export async function randomDelay(minSec = 1, maxSec = 4) {
  const diff = maxSec - minSec + 1;
  const sec = Math.floor(Math.random() * diff) + minSec;
  const ms = sec * 1000;
  console.log(`[DEBUG] sleep ${ms}ms`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------------------
   5) NAVER / other API keys + Proxy
--------------------------------------------- */
export const NAVER_LOCAL_CLIENT_ID = process.env.NAVER_LOCAL_CLIENT_ID;
export const NAVER_LOCAL_CLIENT_SECRET = process.env.NAVER_LOCAL_CLIENT_SECRET;
export const NAVER_MAP_CLIENT_ID = process.env.NAVER_MAP_CLIENT_ID;
export const NAVER_MAP_CLIENT_SECRET = process.env.NAVER_MAP_CLIENT_SECRET;

export const PROXY_SERVER = ''; 