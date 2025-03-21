// dbHelpers.js
import Keyword from '../../models/Keyword.js';

/**
 * 키워드의 basic_crawled = true 로 업데이트 + last_crawled_date 갱신
 */
export async function updateKeywordBasicCrawled(keywordId) {
  try {
    await Keyword.update(
      {
        basic_crawled: true,
        basic_last_crawled_date: new Date()
      },
      { where: { id: keywordId } }
    );
    console.log(`[INFO] 키워드 ID ${keywordId}의 basic_crawled=true 상태 업데이트 완료`);
    return true;
  } catch (err) {
    console.error(`[ERROR] 키워드 ID ${keywordId}의 basic_crawled 상태 업데이트 실패:`, err);
    return false;
  }
}

/**
 * 키워드의 detail_crawled = true 로 업데이트 + last_crawled_date 갱신
 */
export async function updateKeywordDetailCrawled(keywordId) {
  try {
    await Keyword.update(
      { 
        detail_crawled: true,
        detail_last_crawled_date: new Date() 
      },
      { where: { id: keywordId } }
    );
    console.log(`[INFO] 키워드 ID ${keywordId}의 detail_crawled=true 상태 업데이트 완료`);
    return true;
  } catch (err) {
    console.error(`[ERROR] 키워드 ID ${keywordId}의 detail_crawled 상태 업데이트 실패:`, err);
    return false;
  }
}

/**
 * 키워드 ID로 관련 place 정보의 크롤링 상태 확인
 * @returns {Object} 크롤링 상태 통계
 */
export async function getKeywordCrawlStatus(keywordId) {
  try {
    const keyword = await Keyword.findByPk(keywordId);
    if (!keyword) {
      throw new Error(`키워드 ID ${keywordId}를 찾을 수 없습니다.`);
    }
    
    const totalPlaces = await KeywordCrawlResult.count({
      where: { keyword_id: keywordId }
    });
    
    const detailedPlaces = await KeywordCrawlResult.count({
      where: { 
        keyword_id: keywordId,
        [Op.not]: [
          { blog_review_count: 0 },
          { blog_review_count: null }
        ]
      }
    });
    
    return {
      keywordId,
      keywordName: keyword.keyword,
      basicCrawled: keyword.basic_crawled,
      detailCrawled: keyword.detail_crawled,
      totalPlaces,
      detailedPlaces,
      completionRate: totalPlaces > 0 ? (detailedPlaces / totalPlaces * 100).toFixed(2) + '%' : '0%',
      lastCrawledDate: keyword.last_crawled_date
    };
  } catch (err) {
    console.error(`[ERROR] 키워드 ID ${keywordId}의 크롤링 상태 확인 실패:`, err);
    throw err;
  }
}