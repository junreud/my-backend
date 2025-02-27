// config/crawler.js
import 'dotenv/config';

module.exports = {
    MOBILE_USER_AGENT: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15A372 Safari/604.1',
    PROXY_SERVER: '', // 프록시 사용 시 주소
    NAVER_LOCAL_CLIENT_ID: process.env.NAVER_LOCAL_CLIENT_ID,
    NAVER_LOCAL_CLIENT_SECRET: process.env.NAVER_LOCAL_CLIENT_SECRET,
    NAVER_MAP_CLIENT_ID: process.env.NAVER_MAP_CLIENT_ID,
    NAVER_MAP_CLIENT_SECRET: process.env.NAVER_MAP_CLIENT_SECRET
  };