import { saveAlbamonCookies } from '../config/albamonConfig.js';

async function main() {
  try {
    console.log('알바몬 로그인 창이 열립니다. 수동으로 로그인 후 브라우저를 닫아주세요.');
    await saveAlbamonCookies();
    console.log('알바몬 쿠키가 성공적으로 저장되었습니다!');
  } catch (error) {
    console.error('쿠키 저장 중 오류 발생:', error);
  }
}

main();