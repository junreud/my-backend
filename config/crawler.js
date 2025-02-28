// crawler.js (ESM 버전)
import 'dotenv/config';

export const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)' +
  ' AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15A372 Safari/604.1';

export const PROXY_SERVER = ''; // 프록시 사용 시 주소

export const NAVER_LOCAL_CLIENT_ID = process.env.NAVER_LOCAL_CLIENT_ID;
export const NAVER_LOCAL_CLIENT_SECRET = process.env.NAVER_LOCAL_CLIENT_SECRET;
export const NAVER_MAP_CLIENT_ID = process.env.NAVER_MAP_CLIENT_ID;
export const NAVER_MAP_CLIENT_SECRET = process.env.NAVER_MAP_CLIENT_SECRET;
