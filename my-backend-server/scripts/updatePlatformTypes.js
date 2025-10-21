// scripts/updatePlatformTypes.js
import { updateAllBlogReviewPlatformTypes } from '../utils/updatePlatformTypes.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('UpdatePlatformTypesScript');

async function main() {
  try {
    logger.info('블로그 리뷰 플랫폼 타입 일괄 업데이트 시작...');
    
    const results = await updateAllBlogReviewPlatformTypes();
    
    logger.info('업데이트 완료!', results);
    console.log('\n=== 플랫폼 타입 업데이트 결과 ===');
    console.log(`총 업데이트: ${results.updated}개`);
    console.log(`블로그: ${results.blog}개`);
    console.log(`카페: ${results.cafe}개`);
    console.log(`기타: ${results.other}개`);
    
    process.exit(0);
  } catch (error) {
    logger.error('업데이트 실패:', error);
    console.error('업데이트 중 오류가 발생했습니다:', error.message);
    process.exit(1);
  }
}

main();
