// scripts/resetAdAnalysis.js
import Review from '../models/Review.js';
import { createLogger } from '../lib/logger.js';
import { Op } from 'sequelize';

const logger = createLogger('ResetAdAnalysisScript');

/**
 * 광고 분석 결과 초기화
 * @param {string} placeId - 특정 업체 ID (선택사항)
 * @param {boolean} onlyFailed - 실패한 분석만 초기화할지 여부
 */
async function resetAdAnalysis(placeId = null, onlyFailed = false) {
  try {
    logger.info('광고 분석 결과 초기화 시작...', { placeId, onlyFailed });
    
    const whereCondition = {
      review_type: 'blog'
    };
    
    if (placeId) {
      whereCondition.place_id = placeId;
    }
    
    if (onlyFailed) {
      // 분석 실패한 것들만 (ad_analyzed_at이 null이 아니지만 is_ad가 null인 경우)
      whereCondition.ad_analyzed_at = { [Op.not]: null };
      whereCondition.is_ad = null;
    }
    
    const updateFields = {
      is_ad: null,
      ad_confidence: null,
      ad_analysis_result: null,
      ad_analyzed_at: null
    };
    
    const [affectedRows] = await Review.update(updateFields, {
      where: whereCondition
    });
    
    logger.info(`광고 분석 결과 초기화 완료: ${affectedRows}개 리뷰`);
    console.log(`\n=== 광고 분석 초기화 결과 ===`);
    console.log(`초기화된 리뷰 수: ${affectedRows}개`);
    
    return { affectedRows };
    
  } catch (error) {
    logger.error('광고 분석 초기화 실패:', error);
    console.error('초기화 중 오류가 발생했습니다:', error.message);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const placeId = args.find(arg => arg.startsWith('--place='))?.split('=')[1];
  const onlyFailed = args.includes('--only-failed');
  
  try {
    await resetAdAnalysis(placeId, onlyFailed);
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

// 직접 실행된 경우에만 main 함수 호출
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { resetAdAnalysis };
