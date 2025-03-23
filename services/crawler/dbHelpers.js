// dbHelpers.js
import Keyword from '../../models/Keyword.js';
import KeywordBasicCrawlResult from '../../models/KeywordBasicCrawlResult.js';
import PlaceDetailResult from '../../models/PlaceDetailResult.js';
import { Op } from 'sequelize';
import { createLogger } from '../../lib/logger.js';
import sequelize from '../../config/db.js';

const logger = createLogger('DbHelpersLogger');

/**
 * 키워드의 basic_last_crawled_date 갱신
 */
export async function updateKeywordBasicCrawled(keywordId) {
  try {
    const keyword = await Keyword.findByPk(keywordId);
    if (keyword) {
      await keyword.update({
        basic_last_crawled_date: new Date() // 현재 시간으로 업데이트
      });
      logger.info(`[INFO] 키워드 ID ${keywordId} basic_last_crawled_date 업데이트 성공`);
      return true;
    }
    return false;
  } catch (err) {
    logger.error(`[ERROR] 키워드 ID ${keywordId} basic_last_crawled_date 업데이트 중 오류:`, err);
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
    
    const hasBasicCrawled = keyword.basic_last_crawled_date !== null;
    
    // 키워드의 기본 크롤링 결과에서 place_id 목록 가져오기
    const basicCrawlResults = await KeywordBasicCrawlResult.findAll({
      where: { keyword_id: keywordId },
      attributes: ['place_id']
    });
    
    const placeIds = basicCrawlResults.map(result => result.place_id);
    const totalPlaces = placeIds.length;
    
    // place_detail_results 테이블에서 상세 정보가 있는 장소 수 확인
    const detailedPlaces = await PlaceDetailResult.count({
      where: { 
        place_id: {
          [Op.in]: placeIds
        },
        blog_review_count: {
          [Op.ne]: null
        }
      }
    });
    
    return {
      keywordId,
      keywordName: keyword.keyword,
      hasBasicCrawled,
      totalPlaces,
      detailedPlaces,
      completionRate: totalPlaces > 0 ? (detailedPlaces / totalPlaces * 100).toFixed(2) + '%' : '0%',
      basicLastCrawledDate: keyword.basic_last_crawled_date
    };
  } catch (err) {
    logger.error(`[ERROR] 키워드 ID ${keywordId}의 크롤링 상태 확인 실패:`, err);
    throw err;
  }
}

/**
 * Sequelize 모델의 실제 존재하는 필드 확인
 * @param {Object} model - Sequelize 모델
 * @param {Array} requestedFields - 요청하려는 필드 배열
 * @returns {Array} 실제 존재하는 필드 배열
 */
export async function getValidAttributes(model, requestedFields) {
  try {
    const tableInfo = await sequelize.getQueryInterface().describeTable(model.tableName);
    const validFields = requestedFields.filter(field => tableInfo[field]);
    
    if (validFields.length !== requestedFields.length) {
      const missingFields = requestedFields.filter(field => !tableInfo[field]);
      logger.warn(`[WARN] 테이블 ${model.tableName}에 존재하지 않는 필드: ${missingFields.join(', ')}`);
    }
    
    return validFields;
  } catch (err) {
    logger.error(`[ERROR] 테이블 ${model.tableName} 필드 확인 중 오류:`, err);
    // 오류 발생 시 원본 필드 반환
    return requestedFields;
  }
}