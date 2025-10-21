import Place from "../models/Place.js";
// 수정: 올바른 서비스 파일 경로 사용
import { normalizePlaceUrl } from "../services/normalizePlaceUrl.js";
import { getNaverPlaceFullInfo } from "../services/naverPlaceFullService.js";
import { analyzePlaceWithChatGPT } from "../services/chatGPTService.js";
import { groupKeywordsByNaverTop10 } from "../services/keywordGrounpingService.js";
import { getSearchVolumes } from "../services/naverAdApiService.js";
// 추가: Keyword 모델을 직접 임포트
import Keyword from "../models/Keyword.js";
import UserPlaceKeyword from "../models/UserPlaceKeyword.js";
import KeywordBasicCrawlResult from "../models/KeywordBasicCrawlResult.js"; // 추가: 키워드 크롤링 결과 모델
import PlaceDetailResult from "../models/PlaceDetailResult.js"; // 추가: 장소 상세 결과 모델
// 수정: sequelize와 Op 올바르게 import
import sequelize from "../config/db.js";
import { Op } from "sequelize";
// 추가: 크롤러 서비스 임포트
import { crawlKeywordBasic } from "../services/crawler/basicCrawlerService.js";
import { createLogger } from '../lib/logger.js';
import { keywordQueue } from "../services/crawler/keywordQueue.js";
import { checkIsRestaurantByDOM } from "../services/isRestaurantChecker.js"; // 추가: isRestaurant 확인 함수 임포트
import { createControllerHelper } from '../utils/controllerHelpers.js';

const { handleDbOperation, validateRequiredFields, handleNotFound, validateArray, logger } = createControllerHelper('KeywordController');
/**
 * 사용자가 이미 해당 장소를 등록했는지 확인하는 함수
 * @param {string} userId 사용자 ID
 * @param {string} placeId 장소 ID
 * @returns {Promise<boolean>} 이미 등록되었다면 true, 그렇지 않으면 false
 */
async function checkPlaceExists(userId, placeId) {
  try {
    // Sequelize를 사용하여 장소 존재 여부 확인
    const place = await Place.findOne({
      where: {
        user_id: userId,
        place_id: placeId
      }
    });
    
    // 결과가 있으면 이미 등록된 장소
    return !!place;
  } catch (error) {
    logger.error('[ERROR] checkPlaceExists:', error);
    // 에러 발생 시 false 반환 (정상 흐름 유지)
    return false;
  }
}

// export async function normalizeUrlHandler(req, res) {
export async function normalizeUrlHandler(req) {
  // try { // try-catch will be handled by asyncHandler in routes
    logger.info('[INFO] normalizeUrlHandler body:', req.body);
    const { url, platform, userId } = req.body;
    
    // Validate required fields
    const validation = validateRequiredFields(req.body, ['url', 'platform']);
    if (validation) {
      // return sendError(res, 400, validation.message);
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }
    
    if (platform !== "naver") {
      // return sendError(res, 400, "현재는 NAVER 플랫폼만 지원합니다.");
      const error = new Error("현재는 NAVER 플랫폼만 지원합니다.");
      error.statusCode = 400;
      throw error;
    }

    const normalizedUrl = await handleDbOperation(async () => {
      return await normalizePlaceUrl(url);
    }, "URL 정규화");
    
    if (!normalizedUrl) {
      // return sendError(res, 400, "URL을 정규화할 수 없습니다.");
      const error = new Error("URL을 정규화할 수 없습니다.");
      error.statusCode = 400;
      throw error;
    }

    // (1) 장소 정보 가져오기
    const placeInfo = await handleDbOperation(async () => {
      return await getNaverPlaceFullInfo(normalizedUrl);
    }, "장소 정보 조회");

    // (2) Passport JWT 인증이 붙어 있다면, 여기서 req.user가 존재
    //     userId를 placeInfo에 추가하여 프론트로 전달
    const authenticatedUserId = req.user?.id || userId;
    if (!authenticatedUserId) {
      // return sendError(res, 401, "인증되지 않은 사용자입니다.");
      const error = new Error("인증되지 않은 사용자입니다.");
      error.statusCode = 401;
      throw error;
    }
    
    // placeInfo에 userid 필드로 넣기
    placeInfo.userid = authenticatedUserId;

    // (3) 장소 ID 추출 - normalizePlaceUrl에서 이미 추출되었으므로, 여기서 다시 추출
    // URL에서 place_id 추출 (restaurant/12345678 또는 place/12345678 형식에서)
    const match = normalizedUrl.match(/(?:place\/|restaurant\/|cafe\/|\/)(\d+)(?:\/|$|\?)/);
    if (!match) {
      // return sendError(res, 400, "URL에서 place ID를 추출할 수 없습니다.");
      const error = new Error("URL에서 place ID를 추출할 수 없습니다.");
      error.statusCode = 400;
      throw error;
    }
    const placeId = match[1];

    // (4) DB에서 이미 등록된 place_id인지 확인
    const alreadyRegistered = await handleDbOperation(async () => {
      return await checkPlaceExists(authenticatedUserId, placeId);
    }, "장소 중복 확인");

    logger.info(`[INFO] Normalized URL = ${normalizedUrl}`);
    logger.info(`[INFO] Place Info = ${JSON.stringify(placeInfo)}`);
    logger.info(`[INFO] Already Registered = ${alreadyRegistered}`);
    
    // return sendSuccess(res, {
    return {
      normalizedUrl,
      placeInfo,
      alreadyRegistered // 중복 등록 여부 플래그 추가
    };
  // } catch (err) { // try-catch will be handled by asyncHandler in routes
  //   return sendError(res, 500, err.message);
  // }
}


/** 
 * 2) places 테이블에 저장 
 *    POST /analysis/store-place
 */
// export async function storePlaceHandler(req, res) {
export async function storePlaceHandler(req) {
  // try {
    logger.info('[STORE_PLACE] Handler called with body:', req.body);
    const { user_id, place_id, place_name, category, platform } = req.body;
    
    // 타입 확인 로깅
    logger.info('[STORE_PLACE] Parameter types:', {
      user_id: typeof user_id,
      place_id: typeof place_id,
      place_name: typeof place_name,
      category: typeof category,
      platform: typeof platform
    });
    
    // Validate required fields
    const validation = validateRequiredFields(req.body, ['user_id', 'place_id', 'place_name']);
    if (validation) {
      // return sendError(res, 400, validation.message);
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }

    // (A) 중복 체크 - 더 자세한 로깅
    logger.info(`[STORE_PLACE] Checking for existing place: user_id=${user_id}, place_id=${place_id}`);
    const existing = await handleDbOperation(async () => {
      return await Place.findOne({ where: { user_id, place_id } });
    }, "장소 중복 확인");
    
    if (existing) {
      logger.info(
        `[STORE_PLACE] DUPLICATE FOUND - place_id=${place_id} is already registered for user_id=${user_id}, skipping creation. Existing record ID: ${existing.id}`
      );
      // return sendSuccess(res, {}, "이미 등록된 place이므로 새로 생성하지 않았습니다.");
      return { message: "이미 등록된 place이므로 새로 생성하지 않았습니다." };
    }

    // (B) DB 저장
    logger.info(`[STORE_PLACE] Creating new place: user_id=${user_id}, place_id=${place_id}, place_name=${place_name}`);
    const newPlace = await handleDbOperation(async () => {
      return await Place.create({ user_id, place_id, place_name, category });
    }, "장소 저장");
    
    logger.info(`[STORE_PLACE] SUCCESS - Stored place = ${place_name} (${place_id}) for user ${user_id}, new record ID: ${newPlace.id}`);
    // return sendSuccess(res, {});
    return { message: "장소가 성공적으로 저장되었습니다." }; // Return a success message or data
  // } catch (err) {
  //   return sendError(res, 500, err.message);
  // }
}
/**
 * 3) ChatGPT 키워드 생성
 *    POST /analysis/chatgpt
 */
// export async function chatgptKeywordsHandler(req, res) {
export async function chatgptKeywordsHandler(req) {
  // try {
    const { placeInfo } = req.body;
    
    // Validate required fields
    const validation = validateRequiredFields(req.body, ['placeInfo']);
    if (validation) {
      // return sendError(res, 400, validation.message);
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }
    
    // placeInfo에는 { shopIntro, blogReviewTitles... } 등 정보가 있다고 가정

    // URL에서 restaurant 여부 확인
    const isRestaurant = placeInfo.normalizedUrl && 
                          placeInfo.normalizedUrl.includes("restaurant") ? true : false;
    
    // placeInfo에 isRestaurant 정보 추가
    const placeInfoWithType = {
      ...placeInfo,
      isRestaurant
    };

    // ChatGPT 분석 (isRestaurant 정보 포함하여 전달)
    const { locationKeywords, featureKeywords } = await handleDbOperation(async () => {
      return await analyzePlaceWithChatGPT(placeInfoWithType);
    }, "ChatGPT 키워드 분석");

    // 혹은 category 쓰일 수 있음
    if (!locationKeywords.length && !featureKeywords.length) {
      // 빈 값이라도 일단 응답
      // return sendSuccess(res, { locationKeywords: [], featureKeywords: [] });
      return { locationKeywords: [], featureKeywords: [] };
    }
    
    logger.info(`[INFO] ChatGPT Keywords: ${locationKeywords}, ${featureKeywords}`);
    // return sendSuccess(res, {
    return {
      locationKeywords,
      featureKeywords,
    };
  // } catch (err) {
  //   return sendError(res, 500, err.message);
  // }
}

// (B) Express 라우트 핸들러
// export async function combineLocationAndFeaturesHandler(req, res) {
export async function combineLocationAndFeaturesHandler(req) {
  // try {
    logger.debug("[DEBUG] /keyword/combine req.body =", req.body);
    // 1) req.body 로부터 locationKeywords, featureKeywords 추출
    const { locationKeywords, featureKeywords } = req.body;

    // 2) validation
    // if (!validateArray(res, locationKeywords, 'locationKeywords') || 
    //     !validateArray(res, featureKeywords, 'featureKeywords')) {
    //   return; // validateArray already sent response
    // }
    if (!Array.isArray(locationKeywords)) {
        const error = new Error('locationKeywords must be an array');
        error.statusCode = 400;
        throw error;
    }
    if (!Array.isArray(featureKeywords)) {
        const error = new Error('featureKeywords must be an array');
        error.statusCode = 400;
        throw error;
    }
    
    // (A) 순수 로직 함수
    function combineLocationAndFeatures({ locationKeywords, featureKeywords }) {
      const combinedSet = new Set();
      for (const loc of locationKeywords) {
        for (const feat of featureKeywords) {
          const keyword = loc + feat;
          combinedSet.add(keyword);
        }
      }
      // 최대 100개만
      return Array.from(combinedSet).slice(0, 100);
    }

    // 3) 위에서 만든 순수 로직 함수 호출
    const finalArr = combineLocationAndFeatures({ locationKeywords, featureKeywords });

    // 4) 응답
    // return sendSuccess(res, { candidateKeywords: finalArr });
    return { candidateKeywords: finalArr };
  // } catch (err) {
  //   return sendError(res, 500, err.message);
  // }
}

/**
 * 5) 검색광고 API 조회 (검색량)
 *    POST /analysis/search-volume
 *    body: { candidateKeywords: string[] }
 */
// export async function searchVolumesHandler(req, res) {
export async function searchVolumesHandler(req) {
  // try {
    // 1) candidateKeywords와 normalizedUrl 읽기
    const { candidateKeywords, normalizedUrl } = req.body;

    // Validate required fields
    const validation = validateRequiredFields(req.body, ['candidateKeywords']);
    if (validation) {
      // return sendError(res, 400, validation.message);
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }

    // if (!validateArray(res, candidateKeywords, 'candidateKeywords')) {
    //   return; // validateArray already sent response
    // }
    if (!Array.isArray(candidateKeywords)) {
        const error = new Error('candidateKeywords must be an array');
        error.statusCode = 400;
        throw error;
    }

    const isRestaurant = normalizedUrl && normalizedUrl.includes("restaurant") ? 1 : 0;

    // 3) 검색광고 API 조회
    const externalDataList = await handleDbOperation(async () => {
      return await getSearchVolumes(candidateKeywords);
    }, "검색량 조회");
    
    logger.info(`[INFO] External Data List: ${JSON.stringify(externalDataList)}`);

    // 필터: 검색량 null 또는 200 미만인 키워드는 제외
    const filteredDataList = externalDataList.filter(d => typeof d.monthlySearchVolume === 'number' && d.monthlySearchVolume >= 200);

    // 4) DB 저장/업데이트 (필터된 리스트만)
    await handleDbOperation(async () => {
      return Promise.all(
        filteredDataList.map(async (data) => {
          const { keyword, monthlySearchVolume } = data;
          if (!keyword) return;

          // DB에서 keyword 일치 여부 확인
          let keywordRecord = await Keyword.findOne({ where: { keyword } });
          if (keywordRecord) {
            // 이미 있으면 monthlySearchVolume, last_search_volume 업데이트
            await keywordRecord.update({
              monthlySearchVolume,
              last_search_volume: monthlySearchVolume
            });
          } else {
            // 없으면 새로 생성
            await Keyword.create({
              keyword,
              monthlySearchVolume,
              last_search_volume: monthlySearchVolume,
              isRestaurant
            });
          }
        })
      );
    }, "키워드 저장/업데이트");

    // 5) 응답 (필터된 리스트만 반환)
    // return sendSuccess(res, { externalDataList: filteredDataList });
    return { externalDataList: filteredDataList };
  // } catch (err) {
  //   return sendError(res, 500, err.message);
  // }
}

/**
 * 6) 키워드 그룹핑
 *    POST /analysis/group
 *    body: { externalDataList: { keyword, monthlySearchVolume }[] }
 */
// export async function groupKeywordsHandler(req, res) {
export async function groupKeywordsHandler(req) {
  // try {
    const { externalDataList } = req.body;
    
    // Validate required fields
    const validation = validateRequiredFields(req.body, ['externalDataList']);
    if (validation) {
      // return sendError(res, 400, validation.message);
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }

    // if (!validateArray(res, externalDataList, 'externalDataList')) {
    //   return; // validateArray already sent response
    // }
    if (!Array.isArray(externalDataList)) {
        const error = new Error('externalDataList must be an array');
        error.statusCode = 400;
        throw error;
    }

    // 클라이언트 타임아웃 방지를 위해 처리할 키워드 수 제한
    const MAX_KEYWORDS = 20; // 안정적으로 처리 가능한 수로 감소
    const limitedKeywords = externalDataList.slice(0, MAX_KEYWORDS);
    
    if (limitedKeywords.length < externalDataList.length) {
      logger.info(`[INFO] 너무 많은 키워드가 요청됨. ${externalDataList.length}개 중 ${MAX_KEYWORDS}개만 처리합니다.`);
    }
    
    // 항상 동기적으로 처리 (비동기 처리 제거)
    const finalKeywords = await handleDbOperation(async () => {
      return await groupKeywordsByNaverTop10(limitedKeywords);
    }, "키워드 그룹핑");
    
    // 모든 그룹을 저장 (단일 키워드 그룹 포함)
    if (finalKeywords && finalKeywords.length > 0) {
      await handleDbOperation(async () => {
        return await saveAllKeywordGroupsLogic(finalKeywords);
      }, "키워드 그룹 저장");
      
      logger.info(`[INFO] 키워드 그룹화 완료: ${finalKeywords.length}개 그룹 생성`);
      
      // 그룹화 결과 반환 (모든 케이스에서 동일한 형식)
      // return sendSuccess(res, { 
      return { 
        finalKeywords,
        message: `키워드 그룹화 완료: ${finalKeywords.length}개 그룹 생성`
      };
    } else {
      // return sendSuccess(res, { 
      return { 
        finalKeywords: [],
        message: "그룹화된 키워드가 없습니다."
      };
    }
  // } catch (err) {
  //   return sendError(res, 500, err.message);
  // }
}

/**
 * (로직 전용) 모든 그룹화된 키워드들을 keyword_relations 테이블에 저장하는 함수
 * 단일 키워드 그룹도 포함
 */
export async function saveAllKeywordGroupsLogic(finalKeywords) {
  // finalKeywords 순회 - 각 그룹마다 처리
  for (const group of finalKeywords) {
    if (!group.combinedKeyword) continue;

    // 쉼표(,)로 분리 - 이 키워드들은 검색 결과가 유사하므로 같은 그룹
    const splitted = group.combinedKeyword
      .split(",")
      .map((kw) => kw.trim())
      .filter((kw) => kw.length > 0);
      
    // 빈 그룹이면 스킵
    if (splitted.length === 0) continue;

    // Keyword 테이블에서 검색/생성 -> keywordIds
    let keywordIds = [];
    for (const kw of splitted) {
      let keywordRecord = await Keyword.findOne({ where: { keyword: kw } });
      if (!keywordRecord) {
        keywordRecord = await Keyword.create({ keyword: kw });
      }
      keywordIds.push(keywordRecord.id);
    }
    
    // 단일 키워드 그룹은 그냥 키워드 테이블에만 저장
    if (splitted.length < 2) {
      logger.info(`[INFO] 단일 키워드 그룹: ${group.combinedKeyword} (DB에 저장됨)`);
      continue;
    }

    // 2개 이상 키워드 그룹은 keyword_relations 테이블에 저장
    // 각 키워드가 관련이 있는지 확인
    const columns = [];
    const placeholders = [];
    const values = [];
    
    // 최대 3개 키워드만 저장 (테이블 설계에 맞춤)
    for (let i = 0; i < keywordIds.length && i < 3; i++) {
      columns.push(`related_keyword_id_${i + 1}`);
      placeholders.push('?');
      values.push(keywordIds[i]);
    }
    
    // 이미 동일한 키워드 조합이 저장되어 있는지 확인
    const checkQuery = `
      SELECT id FROM keyword_relations 
      WHERE related_keyword_id_1 = ? 
      AND (
        related_keyword_id_2 = ? OR related_keyword_id_2 IS NULL
      ) AND (
        related_keyword_id_3 = ? OR related_keyword_id_3 IS NULL
      )
    `;
    
    const checkValues = [
      keywordIds[0] || null,
      keywordIds[1] || null,
      keywordIds[2] || null
    ];
    
    const [existingRows] = await sequelize.query(checkQuery, { 
      replacements: checkValues 
    });
    
    if (existingRows && existingRows.length > 0) {
      logger.info(`[INFO] 키워드 관계가 이미 존재합니다: ${group.combinedKeyword}`);
      continue;
    }
    
    // 새로운 관계 저장
    const insertQuery = `
      INSERT INTO keyword_relations (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
    `;
    
    await sequelize.query(insertQuery, { replacements: values });
    logger.info(`[INFO] 키워드 관계 저장 완료: ${group.combinedKeyword}`);
  }
}


/**
 * (로직 전용) 그룹화된 키워드들을 keyword_relations 테이블에 저장하는 함수
 *  - finalKeywords: [
 *      {
 *        "combinedKeyword": "사당역맛집, 사당맛집", // 그룹화된 키워드들 (검색 결과가 유사한 키워드들)
 *        "details": [ { "rank":1,"monthlySearchVolume":87900 }, ... ]
 *      },
 *      ...
 *    ]
 */
export async function saveGroupedKeywordsLogic(finalKeywords) {
  // finalKeywords 순회 - 각 그룹마다 처리
  for (const group of finalKeywords) {
    if (!group.combinedKeyword) continue;

    // 쉼표(,)로 분리 - 이 키워드들은 검색 결과가 유사하므로 같은 그룹
    const splitted = group.combinedKeyword
      .split(",")
      .map((kw) => kw.trim())
      .filter((kw) => kw.length > 0);

    // (1) 2개 이상 묶인 경우에만 relations 테이블에 저장 (그룹이 형성된 경우만 의미있음)
    if (splitted.length < 2) {
      logger.info(`[INFO] Skip single keyword: ${group.combinedKeyword}`);
      continue;
    }

    // (2) Keyword 테이블에서 검색/생성 -> keywordIds
    let keywordIds = [];
    for (const kw of splitted) {
      let keywordRecord = await Keyword.findOne({ where: { keyword: kw } });
      if (!keywordRecord) {
        keywordRecord = await Keyword.create({ keyword: kw });
      }
      keywordIds.push(keywordRecord.id);
    }

    // (3) 새 row 생성 - 그룹화된 키워드들 간의 관계를 저장
    // 각 키워드가 관련이 있는지 확인
    const columns = [];
    const placeholders = [];
    const values = [];
    
    // 최대 3개 키워드만 저장 (테이블 설계에 맞춤)
    for (let i = 0; i < keywordIds.length && i < 3; i++) {
      columns.push(`related_keyword_id_${i + 1}`);
      placeholders.push('?');
      values.push(keywordIds[i]);
    }
    
    // 이미 동일한 키워드 조합이 저장되어 있는지 확인
    const checkQuery = `
      SELECT id FROM keyword_relations 
      WHERE related_keyword_id_1 = ? 
      AND (
        related_keyword_id_2 = ? OR related_keyword_id_2 IS NULL
      ) AND (
        related_keyword_id_3 = ? OR related_keyword_id_3 IS NULL
      )
    `;
    
    const checkValues = [
      keywordIds[0] || null,
      keywordIds[1] || null,
      keywordIds[2] || null
    ];
    
    const [existingRows] = await sequelize.query(checkQuery, { 
      replacements: checkValues 
    });
    
    if (existingRows && existingRows.length > 0) {
      logger.info(`[INFO] Keyword relation already exists for group: ${group.combinedKeyword}`);
      continue;
    }
    
    // 새로운 관계 저장
    const insertQuery = `
      INSERT INTO keyword_relations (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
    `;
    
    await sequelize.query(insertQuery, { replacements: values });
    logger.info(`[INFO] Saved keyword relation for group: ${group.combinedKeyword}`);
  }
}

/**
 * (추가 예시) 그룹 키워드 relations 테이블 저장 로직
 * - 기존 saveGroupedKeywordsLogic()과 유사
 * @param {number[]} keywordIds 
 * @param {string} combinedKeyword
 */
async function saveKeywordRelations(keywordIds, combinedKeyword) {
  if (!keywordIds || keywordIds.length < 2) {
    return; // 2개 이상이 아니라면 의미 없는 그룹
  }

  // 최대 3개 키워드만 저장
  const columns = [];
  const placeholders = [];
  const values = [];

  for (let i = 0; i < keywordIds.length && i < 3; i++) {
    columns.push(`related_keyword_id_${i+1}`);
    placeholders.push('?');
    values.push(keywordIds[i]);
  }

  // 중복 체크
  const checkQuery = `
    SELECT id FROM keyword_relations 
    WHERE related_keyword_id_1 = ?
    AND (related_keyword_id_2 = ? OR related_keyword_id_2 IS NULL)
    AND (related_keyword_id_3 = ? OR related_keyword_id_3 IS NULL)
  `;
  const [rows] = await sequelize.query(checkQuery, {
    replacements: [
      keywordIds[0] || null,
      keywordIds[1] || null,
      keywordIds[2] || null
    ]
  });
  if (rows && rows.length > 0) {
    logger.info(`[INFO] 이미 존재하는 키워드 관계: ${combinedKeyword}`);
    return;
  }

  // 삽입
  const insertQuery = `
    INSERT INTO keyword_relations (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
  `;
  await sequelize.query(insertQuery, { replacements: values });
  logger.info(`[INFO] keyword_relations 저장 완료: ${combinedKeyword}`);
}

/**
 * (핸들러) 그룹화된 키워드를 keyword_relations 테이블에 저장
 * POST /keyword/save-grouped
 * body: { finalKeywords: [ { combinedKeyword: "...", details: ... }, ... ] }
 *
 * - 만약 프론트에서 바로 finalKeywords를 통째로 전송해 저장만 하고 싶을 때 사용
 * - groupKeywordsHandler와는 별도로 사용할 수 있도록 남겨둠
 */
// export async function saveGroupedKeywordsHandler(req, res) {
export async function saveGroupedKeywordsHandler(req) {
  // try {
    const { finalKeywords } = req.body;
    
    // Validate required fields
    const validation = validateRequiredFields(req.body, ['finalKeywords']);
    if (validation) {
      // return sendError(res, 400, validation.message);
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }

    // if (!validateArray(res, finalKeywords, 'finalKeywords')) {
    //   return; // validateArray already sent response
    // }
    if (!Array.isArray(finalKeywords)) {
        const error = new Error('finalKeywords must be an array');
        error.statusCode = 400;
        throw error;
    }

    // 바로 로직 함수 호출
    await handleDbOperation(async () => {
      return await saveGroupedKeywordsLogic(finalKeywords);
    }, "그룹화된 키워드 저장");

    logger.info("[INFO] Grouped keywords saved.");
    // return sendSuccess(res, {}, "Grouped keywords saved.");
    return { message: "Grouped keywords saved." };
  // } catch (err) {
  //   return sendError(res, 500, err.message);
  // }
}

/**
 * 7) 선택된 키워드 저장
 *    POST /keyword/save-selected
 *    body: { placeId: number, keywords: string[] }
 *    Authentication: JWT (req.user)
 */
// export async function saveSelectedKeywordsHandler(req, res) {
export async function saveSelectedKeywordsHandler(req) {
  // try {
    const user_id = req.user.id;
    logger.info('[INFO] 요청 데이터:', { user_id, ...req.body });
    const { placeId, keywords } = req.body;
    const place_id = placeId;

    // Validate required fields
    const validation = validateRequiredFields(req.body, ['placeId', 'keywords']);
    if (validation) {
      // return sendError(res, 400, validation.message);
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }

    // if (!validateArray(res, keywords, 'keywords')) {
    //   return; // validateArray already sent response
    // }
    if (!Array.isArray(keywords)) {
        const error = new Error('keywords must be an array');
        error.statusCode = 400;
        throw error;
    }

    // Fetch existing Place record
    const placeRecord = await handleDbOperation(async () => {
      return await Place.findOne({ where: { user_id, place_id } });
    }, "장소 조회");
    
    if (!placeRecord) {
      // return sendError(res, 400, '먼저 장소를 저장해주세요.');
      const error = new Error('먼저 장소를 저장해주세요.');
      error.statusCode = 400;
      throw error;
    }

    // 1) 입력된 키워드를 DB(Keyword 테이블)에 저장
    // (D) UserPlaceKeyword 테이블 연동 will use placeRecord.place_id
    //    - 그룹화 키워드 등 처리 포함
    const createdIds = [];
    const groupedKeywords = [];
    const keywordDataForMainSelection = []; // 메인 키워드 선택을 위한 데이터 저장

    for (const keywordObj of keywords) {
      let keywordText;
      let isGrouped = false;
      let groupKeywords = [];
      let searchVolume = 0;

      // (A) 다양한 형식의 keywordObj 처리
      if (typeof keywordObj === 'string') {
        keywordText = keywordObj;
      } else if (keywordObj.text) {
        keywordText = keywordObj.text;
        searchVolume = keywordObj.searchVolume || 0;
      } else if (keywordObj.keyword) {
        keywordText = keywordObj.keyword;
        searchVolume = keywordObj.searchVolume || 0;
      } else if (keywordObj.combinedKeyword) {
        const splitArr = keywordObj.combinedKeyword
          .split(',')
          .map(s => s.trim())
          .filter(s => s);
        if (splitArr.length > 1) {
          isGrouped = true;
          groupKeywords = splitArr;
          keywordText = splitArr[0]; // 첫 번째 키워드 사용
        } else if (splitArr.length === 1) {
          keywordText = splitArr[0];
        } else {
          keywordText = keywordObj.combinedKeyword;
        }
        // keywordObj에서 검색량 정보 추출
        if (keywordObj.details && Array.isArray(keywordObj.details) && keywordObj.details.length > 0) {
          const firstDetail = keywordObj.details[0];
          searchVolume = firstDetail.monthlySearchVolume || firstDetail.searchVolume || 0;
        }
      } else {
        logger.warn('[WARN] 유효하지 않은 키워드 형식:', keywordObj);
        continue;
      }

      if (!keywordText || !keywordText.trim()) {
        logger.warn('[WARN] 유효하지 않은 키워드 문자열:', keywordText);
        continue;
      }

      // (B) Keyword DB 저장 (findOrCreate)
      const [keywordRecord] = await Keyword.findOrCreate({
        where: { keyword: keywordText },
        defaults: { keyword: keywordText },
      });
      
      // 검색량 정보가 있으면 업데이트
      if (searchVolume > 0) {
        await keywordRecord.update({
          last_search_volume: searchVolume,
          monthlySearchVolume: searchVolume
        });
      }
      
      createdIds.push(keywordRecord.id);

      // 메인 키워드 선택을 위한 데이터 저장
      keywordDataForMainSelection.push({
        keyword_id: keywordRecord.id,
        keyword: keywordText,
        searchVolume: searchVolume || keywordRecord.monthlySearchVolume || keywordRecord.last_search_volume || 0
      });

      // (C) 그룹화 키워드 저장 로직 (2개 이상이면 relations 로직)
      if (isGrouped && groupKeywords.length > 1) {
        const keywordIds = [keywordRecord.id];
        for (let i = 1; i < groupKeywords.length; i++) {
          const [gk] = await Keyword.findOrCreate({
            where: { keyword: groupKeywords[i] },
            defaults: { keyword: groupKeywords[i] },
          });
          keywordIds.push(gk.id);
        }
        groupedKeywords.push({ keywordIds, combinedKeyword: keywordObj.combinedKeyword });
      }

      // (D) UserPlaceKeyword 테이블 연동
      // Verify active business exists in basic crawl results
      const items = await crawlKeywordBasic(keywordText, keywordRecord.id);
      const placeIds = items.map(i => parseInt(i.placeId, 10));
      if (!placeIds.includes(place_id)) {
        logger.warn(`[WARN] 사용자 ${user_id} 업체 ${place_id} 에서 키워드 "${keywordText}" 검색 결과에 없음. 연결 취소.`);
        continue; // skip linking this keyword
      }
      await UserPlaceKeyword.findOrCreate({
        where: { user_id, place_id, keyword_id: keywordRecord.id },
        defaults: { user_id, place_id, keyword_id: keywordRecord.id, isMain: false }
      });
    }

    // 메인 키워드 설정: 가장 높은 검색량을 가진 키워드를 메인으로 설정
    if (keywordDataForMainSelection.length > 0) {
      // 현재 메인 키워드 해제
      await UserPlaceKeyword.update(
        { isMain: false },
        { where: { user_id, place_id } }
      );

      // 가장 높은 검색량의 키워드 찾기
      const mainKeywordData = keywordDataForMainSelection.reduce((max, current) => {
        return current.searchVolume > max.searchVolume ? current : max;
      });

      // 메인 키워드로 설정
      await UserPlaceKeyword.update(
        { isMain: true },
        { where: { user_id, place_id, keyword_id: mainKeywordData.keyword_id } }
      );

      logger.info(`[INFO] 메인 키워드 설정 완료: "${mainKeywordData.keyword}" (검색량: ${mainKeywordData.searchVolume})`);
    }

    // 2) 그룹화된 키워드 관계를 keyword_relations 테이블에 저장
    //    (이미 있는 로직 재사용)
    for (const group of groupedKeywords) {
      try {
        await saveKeywordRelations(group.keywordIds, group.combinedKeyword);
      } catch (err) {
        logger.warn(`[WARN] 그룹 키워드 relations 저장 중 에러: ${err.message}`);
      }
    }

    // 3) 14:00 조건에 따른 Basic 크롤링 여부 결정 -> 필요 시 수행
    //    (needBasicCrawl = true면 crawlKeywordBasic + detailQueue 추가)
    const now = new Date();
    const today14h = new Date(now);
    today14h.setHours(14, 0, 0, 0);

    for (const id of createdIds) {
      try {
        const keywordRecord = await Keyword.findByPk(id);
        if (!keywordRecord) continue;

        const keywordName = keywordRecord.keyword;
        let needBasicCrawl = false;

        // (A) basic_last_crawled_date 체크
        if (!keywordRecord.basic_last_crawled_date) {
          needBasicCrawl = true;
        } else {
          const lastCrawl = new Date(keywordRecord.basic_last_crawled_date);
          // 오늘 14:00 이전 크롤링이거나 날짜 달라지면 다시 크롤링
          if (now < today14h && lastCrawl < (today14h - 24*60*60*1000)) {
            needBasicCrawl = true;
          } else if (now >= today14h && lastCrawl < today14h) {
            needBasicCrawl = true;
          }
        }

          // (B) 실제 Basic 크롤링
          if (needBasicCrawl) {
            logger.info(`[INFO] 키워드="${keywordName}" 기본 크롤링 시작`);
            
            const items = await crawlKeywordBasic(keywordName, id);

          // 반환된 항목이 있을 때만 detail 크롤링을 진행 (크롤링이 실제로 수행된 경우)
          if (items && items.length > 0) {
            // 2) basic_last_crawled_date는 crawlKeywordBasic 내부에서 이미 업데이트되므로 생략

            // 3) items에서 place_id 추출하여 detail 크롤링을 위해 큐에 등록
            const placeIds = items
              .filter(item => item.placeId)
              .map(item => parseInt(item.placeId, 10));
            
            // 크롤링할 항목이 있으면 큐에 등록 (수정: unifiedProcess 사용)
            if (placeIds.length > 0) {
              await keywordQueue.add('unifiedProcess', { 
                type: 'userDetail', 
                data: { placeIds } 
              }, { priority: 1 });
              logger.info(`[INFO] keywordQueue에 userDetail 작업 등록 (keywordId=${id}, ${placeIds.length}개 place)`);
            }
          }
        } else {
          logger.info(`[INFO] 기본 크롤링 불필요: 키워드="${keywordName}" (이미 최신)`);
        }
      } catch (err) {
        logger.error(`[ERROR] 키워드ID=${id} 처리 중 오류: ${err.message}`);
      }
    }

    // return sendSuccess(res, {}, `${createdIds.length}개 키워드가 저장되고, 필요 시 크롤링이 진행됩니다.`);
    return { message: `${createdIds.length}개 키워드가 저장되고, 필요 시 크롤링이 진행됩니다.` };
  // } catch (err) {
  //   return sendError(res, 500, err.message);
  // }
}


// 키워드 추가 핸들러 - isRestaurant 확인, 검색량 조회 및 저장 개선
// export const addUserKeywordHandler = async (req, res) => {
export const addUserKeywordHandler = async (req) => {
  // try {
    const { userId, placeId, keyword } = req.body;

    // Validate required fields
    const validation = validateRequiredFields(req.body, ['userId', 'placeId', 'keyword']);
    if (validation) {
      // return sendError(res, 400, validation.message);
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }

    // 1. 키워드 레코드 찾기
    let keywordRecord = await handleDbOperation(async () => {
      return await Keyword.findOne({ where: { keyword } });
    }, "키워드 조회");
    
    let created = false;

    // 2. 키워드가 존재하지 않으면 isRestaurant 판별 후 생성
    if (!keywordRecord) {
      created = true;
      
      // 2-1. 네이버 광고 API로 검색량 데이터 먼저 조회
      logger.info(`[INFO] 키워드 "${keyword}" 검색량 조회 시작`);
      let searchVolume = 0;
      try {
        const searchVolumeResults = await getSearchVolumes([keyword]);
        if (searchVolumeResults && searchVolumeResults.length > 0) {
          searchVolume = searchVolumeResults[0].monthlySearchVolume || 0;
          logger.info(`[INFO] 키워드 "${keyword}" 검색량 조회 결과: ${searchVolume}`);
        }
      } catch (searchVolumeError) {
        logger.error(`[ERROR] 키워드 "${keyword}" 검색량 조회 실패:`, searchVolumeError);
        // 검색량 조회 실패해도 계속 진행
      }

      // 2-2. isRestaurantChecker.js의 함수를 사용하여 restaurant 여부 확인
      await handleDbOperation(async () => {
        return await checkIsRestaurantByDOM(keyword);
      }, "레스토랑 여부 확인");
      
      // 2-3. checkIsRestaurantByDOM은 내부적으로 키워드를 생성하므로, 다시 조회
      keywordRecord = await handleDbOperation(async () => {
        return await Keyword.findOne({ where: { keyword } });
      }, "키워드 재조회");
      
      if (!keywordRecord) {
        return sendError(res, 500, "키워드 생성 중 오류가 발생했습니다.");
      }

      // 2-4. 검색량 정보 업데이트
      if (searchVolume > 0) {
        await handleDbOperation(async () => {
          return await keywordRecord.update({
            last_search_volume: searchVolume,
            monthlySearchVolume: searchVolume
          });
        }, "검색량 업데이트");
        logger.info(`[INFO] 키워드 "${keyword}" 검색량(${searchVolume}) 저장 완료`);
      }
      
      logger.info(`[INFO] 새 키워드 "${keyword}" 생성됨, isRestaurant=${keywordRecord.isRestaurant}, searchVolume=${searchVolume}`);
    }

    // 3. 새로 생성된 키워드인 경우 크롤링 시도하여 유효성 확인
    if (created) {
      try {
        logger.info(`[INFO] 새 키워드 "${keyword}" 유효성 확인을 위한 테스트 크롤링 시작`);
        
        // 키워드 크롤링 실행 - 결과가 있는지 확인
        const crawlResult = await crawlKeywordBasic(keyword, keywordRecord.id);
        
        // 크롤링 성공했지만 결과가 없으면 "조건에 맞는 업체가 없음"
        if (crawlResult.success && crawlResult.itemsCount === 0) {
          logger.warn(`[WARN] 키워드 "${keyword}": 조건에 맞는 업체가 없습니다. 키워드 추가 취소.`);
          
          // 새로 생성된 키워드 레코드 삭제 (관련 데이터 정리)
          if (keywordRecord) {
            await keywordRecord.destroy();
            logger.info(`[INFO] 새 키워드 "${keyword}" 삭제됨 (검색 결과 없음)`);
          }
          
          const error = new Error("해당 키워드로 검색되는 업체가 없습니다. 다른 키워드를 사용해주세요.");
          error.statusCode = 400;
          throw error;
        }
        
        // 크롤링 자체가 실패한 경우
        if (!crawlResult.success) {
          logger.error(`[ERROR] 키워드 "${keyword}" 크롤링 실패: ${crawlResult.error}`);
          
          // 새로 생성된 키워드 레코드 삭제
          if (keywordRecord) {
            await keywordRecord.destroy();
            logger.info(`[INFO] 새 키워드 "${keyword}" 삭제됨 (크롤링 실패)`);
          }
          
          const error = new Error("키워드 검증 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
          error.statusCode = 500;
          throw error;
        }
        
        logger.info(`[INFO] 키워드 "${keyword}" 유효성 확인 완료 (${crawlResult.itemsCount}개 업체 발견)`);
        
        // 성공적으로 검증된 키워드는 큐에 추가하지 않음 (이미 crawlKeywordBasic에서 처리됨)
        
      } catch (crawlError) {
        // crawlKeywordBasic에서 던진 에러이거나 위에서 던진 에러
        if (crawlError.statusCode) {
          // 우리가 던진 에러 (검색 결과 없음, 크롤링 실패)
          throw crawlError;
        } else {
          // 예상치 못한 에러
          logger.error(`[ERROR] 키워드 "${keyword}" 크롤링 테스트 중 예상치 못한 오류:`, crawlError);
          
          // 새로 생성된 키워드 레코드 삭제
          if (keywordRecord) {
            try {
              await keywordRecord.destroy();
              logger.info(`[INFO] 새 키워드 "${keyword}" 삭제됨 (예상치 못한 오류)`);
            } catch (deleteError) {
              logger.error(`[ERROR] 키워드 "${keyword}" 삭제 중 오류:`, deleteError);
            }
          }
          
          const error = new Error("키워드 검증 중 시스템 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
          error.statusCode = 500;
          throw error;
        }
      }
    } else if (!keywordRecord.last_search_volume) {
      // 기존 키워드지만 검색량 정보가 없는 경우 업데이트
      try {
        logger.info(`[INFO] 기존 키워드 "${keyword}" 검색량 업데이트 시작`);
        const searchVolumeResults = await getSearchVolumes([keyword]);
        
        if (searchVolumeResults && searchVolumeResults.length > 0) {
          const searchVolume = searchVolumeResults[0].monthlySearchVolume || 0;
          // 검색량 정보 업데이트
          await keywordRecord.update({
            last_search_volume: searchVolume,
            monthlySearchVolume: searchVolume
          });
          logger.info(`[INFO] 기존 키워드 "${keyword}" 검색량(${searchVolume}) 업데이트 완료`);
        }
      } catch (searchVolumeError) {
        // 검색량 조회 실패해도 키워드 추가는 계속 진행
        logger.error(`[ERROR] 기존 키워드 "${keyword}" 검색량 업데이트 실패:`, searchVolumeError);
      }
    }

    // 4. UserPlaceKeyword 테이블 연동
    const [userKeywordRelation, relationCreated] = await handleDbOperation(async () => {
      return await UserPlaceKeyword.findOrCreate({
        where: { user_id: userId, place_id: placeId, keyword_id: keywordRecord.id },
        defaults: { user_id: userId, place_id: placeId, keyword_id: keywordRecord.id },
      });
    }, "사용자-장소-키워드 연결");

    if (!relationCreated) {
      // 이미 존재하는 경우
      logger.info(`[INFO] 사용자 ${userId}의 업체 ${placeId}에 키워드 "${keyword}"가 이미 연결되어 있습니다.`);
    }

    // return sendSuccess(res, {
    return {
      data: { // Explicitly define data property for sendSuccess
        keyword: {
          id: keywordRecord.id,
          keyword: keywordRecord.keyword,
          isRestaurant: keywordRecord.isRestaurant,
          search_volume: keywordRecord.last_search_volume, // 검색량 정보 추가
          relation_id: userKeywordRelation.id
        }
      },
      message: "키워드가 성공적으로 추가되었습니다.", // Explicitly define message for sendSuccess
      statusCode: 201 // Explicitly define statusCode for sendSuccess
    };
  // } catch (error) {
  //   return sendError(res, 500, error.message);
  // }
};

// 키워드 변경 핸들러 - isRestaurant 확인, 검색량 조회 및 저장 개선
// export const changeUserKeywordHandler = async (req, res) => {
export const changeUserKeywordHandler = async (req) => {
  // try {
    const { userId, placeId, oldKeywordId, newKeyword } = req.body;

    // Validate required fields
    const validation = validateRequiredFields(req.body, ['userId', 'placeId', 'oldKeywordId', 'newKeyword']);
    if (validation) {
      // return sendError(res, 400, validation.message);
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }

    if (!newKeyword.trim()) {
      // return sendError(res, 400, "새 키워드가 비어있습니다.");
      const error = new Error("새 키워드가 비어있습니다.");
      error.statusCode = 400;
      throw error;
    }

    // 1. UserPlaceKeyword 테이블에서 기존 연결 찾기
    const userKeyword = await handleDbOperation(async () => {
      return await UserPlaceKeyword.findOne({
        where: {
          user_id: userId,
          place_id: placeId,
          keyword_id: oldKeywordId
        }
      });
    }, "기존 키워드 연결 조회");

    if (!userKeyword) {
      // return handleNotFound(res, "해당 키워드 연결을 찾을 수 없습니다.");
      const error = new Error("해당 키워드 연결을 찾을 수 없습니다.");
      error.statusCode = 404; // Not found
      throw error;
    }

    // 2. Keyword 테이블에서 새 키워드 찾기
    const trimmedKeyword = newKeyword.trim();
    let newKeywordRecord = await handleDbOperation(async () => {
      return await Keyword.findOne({ where: { keyword: trimmedKeyword } });
    }, "새 키워드 조회");
    let created = false;

    // 3. 키워드가 없는 경우 검색량 조회 후 isRestaurant 판별
    if (!newKeywordRecord) {
      created = true;
      
      // 3-1. 네이버 광고 API로 검색량 데이터 먼저 조회
      logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" 검색량 조회 시작`);
      let searchVolume = 0;
      try {
        const searchVolumeResults = await getSearchVolumes([trimmedKeyword]);
        if (searchVolumeResults && searchVolumeResults.length > 0) {
          searchVolume = searchVolumeResults[0].monthlySearchVolume || 0;
          logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" 검색량 조회 결과: ${searchVolume}`);
        }
      } catch (searchVolumeError) {
        logger.error(`[ERROR] 새 키워드 "${trimmedKeyword}" 검색량 조회 실패:`, searchVolumeError);
        // 검색량 조회 실패해도 계속 진행
      }
      
      // 3-2. isRestaurantChecker.js의 함수를 사용하여 restaurant 여부 확인
      await checkIsRestaurantByDOM(trimmedKeyword);
      
      // 3-3. checkIsRestaurantByDOM은 내부적으로 키워드를 생성하므로 다시 조회
      newKeywordRecord = await handleDbOperation(async () => {
        return await Keyword.findOne({ where: { keyword: trimmedKeyword } });
      }); // Removed "새 키워드 재조회" as it's not a user-facing message
      
      if (!newKeywordRecord) {
        // return sendError(res, 500, "키워드 생성 중 오류가 발생했습니다.");
        const error = new Error("키워드 생성 중 오류가 발생했습니다.");
        error.statusCode = 500;
        throw error;
      }

      // 3-4. 검색량 정보 업데이트
      if (searchVolume > 0) {
        await handleDbOperation(async () => {
          return await newKeywordRecord.update({
            last_search_volume: searchVolume,
            monthlySearchVolume: searchVolume
          });
        }, "새 키워드 검색량 업데이트");
        logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" 검색량(${searchVolume}) 저장 완료`);
      }
      
      logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" 생성됨, isRestaurant=${newKeywordRecord.isRestaurant}, searchVolume=${searchVolume}`);
    } else if (!newKeywordRecord.last_search_volume) {
      // 기존 키워드지만 검색량 정보가 없는 경우 업데이트
      try {
        logger.info(`[INFO] 기존 키워드 "${trimmedKeyword}" 검색량 업데이트 시작`);
        const searchVolumeResults = await getSearchVolumes([trimmedKeyword]);
        
        if (searchVolumeResults && searchVolumeResults.length > 0) {
          const searchVolume = searchVolumeResults[0].monthlySearchVolume || 0;
          // 검색량 정보 업데이트
          await handleDbOperation(async () => {
            return await newKeywordRecord.update({
              last_search_volume: searchVolume,
              monthlySearchVolume: searchVolume
            });
          }, "기존 키워드 검색량 업데이트");
          logger.info(`[INFO] 기존 키워드 "${trimmedKeyword}" 검색량(${searchVolume}) 업데이트 완료`);
        }
      } catch (searchVolumeError) {
        // 검색량 조회 실패해도 키워드 변경은 계속 진행
        logger.error(`[ERROR] 기존 키워드 "${trimmedKeyword}" 검색량 업데이트 실패:`, searchVolumeError);
      }
    }

    // 4. 새로 생성된 키워드인 경우에만, 유효한 키워드인지 확인하기 위해 크롤링 테스트 실행
    if (created) {
      try {
        logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" 유효성 확인을 위한 테스트 크롤링 시작`);
        
        // 키워드 크롤링 실행 - 결과가 있는지 확인
        const items = await crawlKeywordBasic(trimmedKeyword, newKeywordRecord.id);
        // Ensure the user's place_id appears in crawl results
        const hasActivePlace = items && items.some(i => String(i.placeId) === String(placeId));
        // 결과가 없으면 "조건에 맞는 업체가 없음" 상태
        if (!items || items.length === 0 || !hasActivePlace) {
          logger.warn(`[WARN] 키워드 "${trimmedKeyword}": 조건에 맞는 업체가 없습니다. 키워드 변경 취소.`);
          
          // 새로 생성된 키워드 레코드 삭제 (관련 데이터 정리)
          if (newKeywordRecord) {
            await newKeywordRecord.destroy();
            logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" 삭제됨 (유효하지 않은 키워드)`);
          }
          // return sendError(res, 400, "조건에 맞는 업체가 없습니다. 다른 키워드를 사용해주세요.");
          const error = new Error("조건에 맞는 업체가 없습니다. 다른 키워드를 사용해주세요.");
          error.statusCode = 400;
          throw error;
        }
        
        logger.info(`[INFO] 키워드 "${trimmedKeyword}" 유효성 확인 완료 (${items.length}개 항목 발견)`);
      } catch (crawlError) {
        logger.error(`[ERROR] 키워드 "${trimmedKeyword}" 크롤링 테스트 중 오류:`, crawlError);
        
        // 크롤링 오류 발생 시 새 키워드 삭제하고 오류 반환
        if (newKeywordRecord) {
          await newKeywordRecord.destroy();
          logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" 삭제됨 (크롤링 오류)`);
        }
        
        // return sendError(res, 500, "키워드 유효성 확인 중 오류가 발생했습니다. 다시 시도해주세요.");
        const error = new Error("키워드 유효성 확인 중 오류가 발생했습니다. 다시 시도해주세요.");
        error.statusCode = 500;
        throw error;
      }
    }

    // 5. UserPlaceKeyword 테이블에서 새 키워드로 이미 연결이 있는지 확인
    const existingRelation = await handleDbOperation(async () => {
      return await UserPlaceKeyword.findOne({
        where: {
          user_id: userId,
          place_id: placeId,
          keyword_id: newKeywordRecord.id
        }
      });
    }, "기존 연결 확인");

    // 6. 기존 연결 삭제
    await handleDbOperation(async () => {
      return await userKeyword.destroy();
    }, "기존 연결 삭제");

    // 7. 새 연결이 없는 경우에만 생성 (중복 방지)
    let userKeywordRelation;
    if (!existingRelation) {
      userKeywordRelation = await handleDbOperation(async () => {
        return await UserPlaceKeyword.create({
          user_id: userId,
          place_id: placeId,
          keyword_id: newKeywordRecord.id
        });
      }, "새 키워드 연결 생성");
    } else {
      userKeywordRelation = existingRelation;
    }

    // 8. Basic 크롤링이 수행되었으므로, 필요한 경우 Detail 크롤링을 예약
    if (created) {
      logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" detail 크롤링 큐에 추가`);
      // Detail 크롤링은 이미 Basic 크롤링 내부에서 처리되었음
    }

    // return sendSuccess(res, {
    return {
      data: { // Explicitly define data property
        keyword: {
          id: newKeywordRecord.id,
          keyword: newKeywordRecord.keyword,
          isRestaurant: newKeywordRecord.isRestaurant,
          search_volume: newKeywordRecord.last_search_volume,
          relation_id: userKeyword.id // 기존 연결 ID 사용
        }
      },
      message: "키워드가 성공적으로 변경되었습니다." // Explicitly define message
    };
  // } catch (error) {
  //   return sendError(res, 500, error.message);
  // }
};


// 메인 키워드 상태 확인 핸들러
// export const getMainKeywordStatusHandler = async (req, res) => {
export const getMainKeywordStatusHandler = async (req) => {
  // try {
    const userId = req.user.id; // JWT 인증을 통해 사용자 ID 가져오기
    const { place_id } = req.query; // 쿼리 파라미터에서 place_id 가져오기

    if (!place_id) {
      const error = new Error("place_id가 필요합니다.");
      error.statusCode = 400;
      throw error;
    }

    // 1. 해당 업체의 정보 가져오기
    const place = await handleDbOperation(async () => {
      return await Place.findOne({ where: { user_id: userId, place_id } });
    }, "업체 정보 조회");
    
    if (!place) {
      const error = new Error("업체를 찾을 수 없습니다.");
      error.statusCode = 404;
      throw error;
    }

    // 2. 메인 키워드 조회 (isMain = true)
    const mainKeywordRelation = await handleDbOperation(async () => {
      return await UserPlaceKeyword.findOne({
        where: { user_id: userId, place_id, isMain: true }
      });
    }, `업체 ${place_id} 메인 키워드 조회`);
    
    if (!mainKeywordRelation) {
      // 메인 키워드가 없는 경우, 가장 높은 검색량의 키워드를 찾아서 메인으로 설정
      const allKeywordRelations = await handleDbOperation(async () => {
        return await UserPlaceKeyword.findAll({
          where: { user_id: userId, place_id }
        });
      }, `업체 ${place_id} 모든 키워드 관계 조회`);

      if (!allKeywordRelations || allKeywordRelations.length === 0) {
        const error = new Error("등록된 키워드가 없습니다.");
        error.statusCode = 404;
        throw error;
      }

      // 각 키워드의 검색량 조회
      let bestKeywordRelation = null;
      let bestSearchVolume = 0;

      for (const relation of allKeywordRelations) {
        const keyword = await handleDbOperation(async () => {
          return await Keyword.findByPk(relation.keyword_id);
        }, `키워드 ${relation.keyword_id} 조회`);

        if (keyword) {
          const searchVolume = keyword.monthlySearchVolume || keyword.last_search_volume || 0;
          if (searchVolume > bestSearchVolume) {
            bestSearchVolume = searchVolume;
            bestKeywordRelation = relation;
          }
        }
      }

      if (!bestKeywordRelation) {
        const error = new Error("유효한 키워드를 찾을 수 없습니다.");
        error.statusCode = 404;
        throw error;
      }

      // 메인 키워드로 설정
      await UserPlaceKeyword.update(
        { isMain: true },
        { where: { user_id: userId, place_id, keyword_id: bestKeywordRelation.keyword_id } }
      );

      const bestKeyword = await handleDbOperation(async () => {
        return await Keyword.findByPk(bestKeywordRelation.keyword_id);
      }, `메인 키워드 ${bestKeywordRelation.keyword_id} 조회`);

      logger.info(`[INFO] 자동으로 메인 키워드 설정: "${bestKeyword.keyword}" (place_id: ${place_id})`);
      
      // 현재 순위 조회
      const latestResult = await handleDbOperation(async () => {
        return await KeywordBasicCrawlResult.findOne({
          where: { 
            keyword_id: bestKeywordRelation.keyword_id,
            place_id: place_id
          },
          order: [['last_crawled_at', 'DESC']],
          raw: true 
        });
      }, `메인 키워드 ${bestKeyword.keyword} 순위 조회`);

      return {
        keywordId: bestKeywordRelation.keyword_id,
        keyword: bestKeyword.keyword,
        searchVolume: bestKeyword.last_search_volume || bestKeyword.monthlySearchVolume || 0,
        currentRank: latestResult ? latestResult.ranking : null,
        diff: 0, // 새로 설정된 메인 키워드는 변화량 0
        place_name: place.place_name
      };
    }

    // 3. 메인 키워드의 현재 순위 조회
    const keywordId = mainKeywordRelation.keyword_id;
    
    const keyword = await handleDbOperation(async () => {
      return await Keyword.findByPk(keywordId);
    }, `메인 키워드 ${keywordId} 조회`);

    if (!keyword) {
      const error = new Error("키워드 정보를 찾을 수 없습니다.");
      error.statusCode = 404;
      throw error;
    }
    
    // 최신 순위 조회
    const latestResult = await handleDbOperation(async () => {
      return await KeywordBasicCrawlResult.findOne({
        where: { 
          keyword_id: keywordId,
          place_id: place_id
        },
        order: [['last_crawled_at', 'DESC']],
        raw: true 
      });
    }, `메인 키워드 ${keyword.keyword} 순위 조회`);

    // 이전 순위와 비교를 위해 최근 2개 결과 조회
    const recentResults = await handleDbOperation(async () => {
      return await KeywordBasicCrawlResult.findAll({
        where: { 
          keyword_id: keywordId,
          place_id: place_id
        },
        order: [['last_crawled_at', 'DESC']],
        limit: 2,
        raw: true 
      });
    }, `메인 키워드 ${keyword.keyword} 최근 순위 변화 조회`);

    let diff = 0;
    if (recentResults && recentResults.length >= 2) {
      const current = recentResults[0].ranking;
      const previous = recentResults[1].ranking;
      if (current && previous) {
        diff = previous - current; // 순위가 올라가면 양수, 내려가면 음수
      }
    }

    return {
      keywordId: keywordId,
      keyword: keyword.keyword,
      searchVolume: keyword.last_search_volume || keyword.monthlySearchVolume || 0,
      currentRank: latestResult ? latestResult.ranking : null,
      diff: diff,
      place_name: place.place_name
    };
  // } catch (error) {
  //   return sendError(res, 500, error.message);
  // }
};

// 업체별 키워드 순위 조회 핸들러
// export const getKeywordRankingsByBusinessHandler = async (req, res) => {
export const getKeywordRankingsByBusinessHandler = async (req) => {
  // try {
    const userId = req.user.id; // JWT 인증을 통해 사용자 ID 가져오기
    const { placeId } = req.query; // 쿼리 파라미터에서 placeId 가져오기

    if (!placeId) {
      // return sendError(res, 400, "placeId가 필요합니다.");
      const error = new Error("placeId가 필요합니다.");
      error.statusCode = 400;
      throw error;
    }

    // 1. 해당 업체의 정보 가져오기
    const place = await handleDbOperation(async () => {
      return await Place.findOne({ where: { user_id: userId, place_id: placeId } });
    }, "업체 정보 조회");
    
    if (!place) {
      // return sendError(res, 404, "업체를 찾을 수 없습니다.");
      const error = new Error("업체를 찾을 수 없습니다.");
      error.statusCode = 404;
      throw error;
    }

    // 2. 해당 업체에 연결된 키워드 및 순위 정보 조회
    const userPlaceKeywords = await handleDbOperation(async () => {
      return await UserPlaceKeyword.findAll({
        where: { user_id: userId, place_id: placeId },
        include: [
          { model: Keyword, attributes: ['id', 'keyword'] }
        ],
      });
    }, "업체 키워드 조회");
    
    const keywordDetails = await Promise.all(
      userPlaceKeywords.map(async (upk) => {
        const upkJSON = upk.toJSON(); 
        const keywordId = upkJSON.keyword_id;
        let keywordText;

        if (!upkJSON.Keyword) {
          const keywordRecord = await handleDbOperation(async () => {
            return await Keyword.findByPk(keywordId, { raw: true });
          }, `키워드 ${keywordId} 직접 조회`);
          keywordText = keywordRecord ? keywordRecord.keyword : `키워드 ID: ${keywordId}`;
        } else {
          keywordText = upkJSON.Keyword.keyword;
        }
        
        const latestResult = await handleDbOperation(async () => {
          return await KeywordBasicCrawlResult.findOne({
            where: { 
              keyword_id: keywordId,
              place_id: placeId
            },
            order: [['last_crawled_at', 'DESC']],
            raw: true 
          });
        }, `키워드 ${keywordText} 크롤링 결과 조회`);

        // 상세 정보도 함께 조회
        const latestDetail = await handleDbOperation(async () => {
          return await PlaceDetailResult.findOne({
            where: { place_id: placeId },
            order: [['created_at', 'DESC']],
            raw: true
          });
        }, `업체 상세 정보 조회`);
        
        // 키워드 검색량 정보 조회
        const keywordInfo = await handleDbOperation(async () => {
          return await Keyword.findByPk(keywordId, { raw: true });
        }, `키워드 ${keywordText} 검색량 정보 조회`);
        
        return {
          id: keywordId, // 프론트엔드에서 키워드 ID로 사용할 값 (keywords 테이블의 실제 ID)
          keyword_id: keywordId, // 백엔드 호환성을 위해 유지
          keyword: keywordText,
          searchVolume: keywordInfo ? (keywordInfo.last_search_volume || keywordInfo.monthlySearchVolume || 0) : 0,
          isRestaurant: keywordInfo ? (keywordInfo.isRestaurant || false) : false, // 키워드의 레스토랑 여부 추가
          ranking: latestResult ? latestResult.ranking : null,
          currentRank: latestResult ? latestResult.ranking : null, // 프론트엔드에서 사용하는 필드명 추가
          place_id: placeId,
          place_name: place.place_name,
          category: place.category || null,
          receipt_review_count: latestDetail ? latestDetail.receipt_review_count : null,
          blog_review_count: latestDetail ? latestDetail.blog_review_count : null,
          savedCount: latestDetail ? latestDetail.savedCount : null,
          crawled_at: latestResult ? latestResult.last_crawled_at : null,
        };
      })
    );

    // 3. 결과 반환 - 프론트엔드가 기대하는 형태로 변환
    // 프론트엔드에서 {keywords: [...]} 형태를 기대하므로 객체로 래핑
    return {
      place_name: place.place_name,
      keywords: keywordDetails
    };
  // } catch (error) {
  //   return sendError(res, 500, error.message);
  // }
};


// 업체별 키워드 히스토리 조회 핸들러
// export const getKeywordHistoryHandler = async (req, res) => {
export const getKeywordHistoryHandler = async (req) => {
  const userId = req.user.id;
  const { placeId, keywordId } = req.query;

  console.log('[DEBUG] getKeywordHistoryHandler called with:', { placeId, keywordId, userId });

  if (!placeId || !keywordId) {
    // return sendError(res, 400, "placeId와 keywordId가 모두 필요합니다.");
    const error = new Error("placeId와 keywordId가 모두 필요합니다.");
    error.statusCode = 400;
    throw error;
  }

  // 1. 해당 키워드 정보 가져오기
  const keyword = await handleDbOperation(async () => {
    return await Keyword.findOne({ where: { id: keywordId } });
  }, "키워드 정보 조회");
  
  console.log('[DEBUG] Found keyword:', keyword ? keyword.keyword : 'not found');
  
  if (!keyword) {
    const error = new Error("키워드를 찾을 수 없습니다.");
    error.statusCode = 404;
    throw error;
  }

  // 2. 키워드 순위 히스토리 조회
  const rankHistory = await handleDbOperation(async () => {
    return await KeywordBasicCrawlResult.findAll({
      where: { place_id: placeId, keyword_id: keywordId },
      order: [["last_crawled_at", "ASC"]]
    });
  }, "키워드 순위 히스토리 조회");

  console.log('[DEBUG] Found rankHistory count:', rankHistory ? rankHistory.length : 0);

  // *** 상세 리뷰 히스토리 조회 추가 ***
  const detailHistory = await handleDbOperation(async () => {
    return await PlaceDetailResult.findAll({
      where: { place_id: placeId },
      order: [["created_at", "ASC"]]
    });
  }, "상세 리뷰 히스토리 조회");

  console.log('[DEBUG] Found detailHistory count:', detailHistory ? detailHistory.length : 0);

  // 3. combined history 생성
  const history = rankHistory.map(basic => {
    const basicDate = basic.last_crawled_at || basic.created_at;
    const basicDay = basicDate.toISOString().split('T')[0];
    const detail = detailHistory.find(d => d.created_at.toISOString().split('T')[0] === basicDay);
    return {
      ...basic.toJSON(),
      blog_review_count: detail ? detail.blog_review_count : null,
      receipt_review_count: detail ? detail.receipt_review_count : null,
      savedCount: detail ? detail.savedCount : null,
      saved_count: detail ? detail.savedCount : null
    };
  });

  console.log('[DEBUG] Final combined history count:', history.length);
  console.log('[DEBUG] Sample history item:', history[0] || 'none');

  // 4. 결과 반환
  return {
    keyword: keyword.keyword,
    isRestaurant: keyword.isRestaurant || false, // 키워드의 레스토랑 여부 추가
    history
  };
};

// 특정 키워드에 대한 순위 테이블 조회 핸들러 (1위~300위 모든 업체)
export const getKeywordRankingTableHandler = async (req) => {
  const userId = req.user.id;
  const { keyword, placeId, rangeValue = 0 } = req.query; // rangeValue 추가 (비교 기간)

  if (!keyword) {
    const error = new Error("keyword가 필요합니다.");
    error.statusCode = 400;
    throw error;
  }

  if (!placeId) {
    const error = new Error("placeId가 필요합니다.");
    error.statusCode = 400;
    throw error;
  }

  // 1. 키워드 정보 가져오기
  const keywordRecord = await handleDbOperation(async () => {
    return await Keyword.findOne({ where: { keyword: keyword } });
  }, "키워드 정보 조회");
  
  if (!keywordRecord) {
    const error = new Error("키워드를 찾을 수 없습니다.");
    error.statusCode = 404;
    throw error;
  }

  console.log(`[DEBUG] 키워드 "${keyword}" 정보:`, {
    id: keywordRecord.id,
    keyword: keywordRecord.keyword,
    isRestaurant: keywordRecord.isRestaurant,
    last_search_volume: keywordRecord.last_search_volume
  });

  // 2. 사용자가 해당 업체와 키워드를 등록했는지 확인
  const userPlaceKeyword = await handleDbOperation(async () => {
    return await UserPlaceKeyword.findOne({
      where: { 
        user_id: userId, 
        place_id: placeId, 
        keyword_id: keywordRecord.id 
      }
    });
  }, "사용자 키워드 등록 확인");

  if (!userPlaceKeyword) {
    console.log(`[DEBUG] 키워드 "${keyword}"가 업체 ${placeId}에 등록되지 않음`);
    const error = new Error("해당 업체에 대한 키워드가 등록되지 않았습니다.");
    error.statusCode = 404;
    throw error;
  }

  // 3. 타겟 날짜 계산 (rangeValue 기반)
  let targetDate = new Date();
  if (parseInt(rangeValue) > 0) {
    targetDate.setDate(targetDate.getDate() - parseInt(rangeValue));
  }
  const targetDateString = targetDate.toISOString().split('T')[0];
  
  console.log('[Debug] Target date for comparison:', {
    rangeValue,
    targetDateString,
    originalDate: new Date().toISOString().split('T')[0]
  });

  // 4. 해당 날짜의 크롤링 데이터 존재 여부 확인
  const crawlDataExists = await handleDbOperation(async () => {
    const count = await KeywordBasicCrawlResult.count({
      where: { 
        keyword_id: keywordRecord.id,
        last_crawled_at: {
          [Op.gte]: new Date(targetDateString + 'T00:00:00Z'),
          [Op.lt]: new Date(targetDateString + 'T23:59:59Z')
        }
      }
    });
    return count > 0;
  }, "타겟 날짜 크롤링 데이터 존재 여부 확인");

  if (!crawlDataExists) {
    // 데이터가 없는 경우 빈 결과와 메타데이터 반환
    return {
      rankingDetails: [],
      rankingList: [],
      chartData: [],
      metadata: {
        keyword: keyword,
        isRestaurant: keywordRecord.isRestaurant, // 키워드의 레스토랑 여부 추가
        totalCount: 0,
        targetDate: targetDateString,
        placeId: placeId,
        rangeValue: parseInt(rangeValue),
        hasData: false,
        message: `${targetDateString} 날짜에 크롤링된 데이터가 없습니다.`
      }
    };
  }

  // 5. 개별 쿼리로 변경 (JOIN 문제 해결을 위해) - 업체명, 업종 포함
  const rankingResults = await handleDbOperation(async () => {
    return await KeywordBasicCrawlResult.findAll({
      where: { 
        keyword_id: keywordRecord.id,
        last_crawled_at: {
          [Op.gte]: new Date(targetDateString + 'T00:00:00Z'),
          [Op.lt]: new Date(targetDateString + 'T23:59:59Z')
        }
      },
      attributes: ['id', 'keyword_id', 'ranking', 'place_id', 'place_name', 'category', 'last_crawled_at'], // 업체명, 업종 포함
      order: [['ranking', 'ASC']],
      raw: true
    });
  }, "순위 결과 조회 (업체명, 업종 포함)");

  console.log(`[DEBUG] 조회된 순위 결과 수: ${rankingResults.length}`);
  if (rankingResults.length > 0) {
    console.log(`[DEBUG] 첫 번째 결과 - place_name: ${rankingResults[0].place_name}, category: ${rankingResults[0].category}`);
  }

  // 6. 필요한 place_id들 추출
  const placeIds = [...new Set(rankingResults.map(result => result.place_id))];
  console.log(`[DEBUG] 고유 place_id 수: ${placeIds.length}, 첫 번째 place_id: ${placeIds[0]}`);

  // 7. Place 정보 일괄 조회
  const places = await handleDbOperation(async () => {
    return await Place.findAll({
      where: { place_id: { [Op.in]: placeIds } },
      attributes: ['place_id', 'place_name', 'category'],
      raw: true
    });
  }, "업체 정보 일괄 조회");

  console.log(`[DEBUG] 조회된 Place 정보 수: ${places.length}`);
  if (places.length > 0) {
    console.log(`[DEBUG] 첫 번째 Place:`, places[0]);
  } else {
    console.log(`[DEBUG] Place 정보가 없습니다. 첫 번째 place_id ${placeIds[0]}에 대한 Place 레코드가 존재하지 않습니다.`);
  }

  console.log(`[DEBUG] 조회된 업체 정보 수: ${places.length}`);
  if (places.length > 0) {
    console.log(`[DEBUG] 첫 번째 업체 정보:`, places[0]);
  }

  // 8. Place 테이블에 없는 업체들 찾기
  const existingPlaceIds = new Set(places.map(p => p.place_id));
  const missingPlaceIds = placeIds.filter(id => !existingPlaceIds.has(id));
  
  if (missingPlaceIds.length > 0) {
    console.log(`[DEBUG] Place 테이블에 없는 업체 ${missingPlaceIds.length}개 발견:`, missingPlaceIds.slice(0, 5));
    
    // ❌ 자동으로 Place 테이블에 업체를 추가하지 않음
    // 크롤링 결과의 업체들을 자동으로 사용자 업체로 등록하는 것은 부적절함
    console.log(`[INFO] Place 테이블에 없는 업체들은 순위 정보만 표시하고 자동 등록하지 않습니다.`);
    
    // 누락된 업체들은 기본 정보로 임시 객체 생성 (DB 저장 없음)
    const tempPlaces = missingPlaceIds.map(place_id => ({
      place_id: place_id,
      place_name: `업체명 미확인 (${place_id})`,
      category: '업종 미확인'
    }));
    
    // 임시 정보를 places 배열에 추가 (순위 표시용)
    places.push(...tempPlaces);
  }

  // 9. Place 정보를 Map으로 변환 (빠른 조회용)
  const placeMap = new Map();
  places.forEach(place => {
    placeMap.set(place.place_id, place);
  });

  // 10. 상세 정보 일괄 조회
  const placeDetails = await handleDbOperation(async () => {
    return await PlaceDetailResult.findAll({
      where: {
        place_id: { [Op.in]: placeIds },
        created_at: {
          [Op.gte]: new Date(targetDateString + 'T00:00Z'),
          [Op.lt]: new Date(targetDateString + 'T23:59:59Z')
        }
      },
      order: [['created_at', 'DESC']],
      raw: true
    });
  }, "상세 정보 일괄 조회");

  console.log(`[DEBUG] 조회된 상세 정보 수: ${placeDetails.length}`);
  console.log(`[DEBUG] 타겟 날짜: ${targetDateString}에 대한 detail crawl 데이터 조회 결과:`);
  if (placeDetails.length === 0) {
    console.log(`[DEBUG] ⚠️  ${targetDateString} 날짜에 detail crawl 데이터가 없습니다!`);
  } else {
    console.log(`[DEBUG] ✅ ${targetDateString} 날짜에 ${placeDetails.length}개의 detail crawl 데이터가 있습니다`);
    console.log(`[DEBUG] 첫 번째 detail 데이터:`, {
      place_id: placeDetails[0].place_id,
      blog_review_count: placeDetails[0].blog_review_count,
      receipt_review_count: placeDetails[0].receipt_review_count,
      savedCount: placeDetails[0].savedCount,
      created_at: placeDetails[0].created_at
    });
  }

  // 10. 상세 정보를 Map으로 변환 (빠른 조회용)
  const detailMap = new Map();
  placeDetails.forEach(detail => {
    if (!detailMap.has(detail.place_id)) {
      detailMap.set(detail.place_id, detail);
    }
  });

  // 11. 최종 결과 구성
  const finalResults = rankingResults.map(result => {
    const place = placeMap.get(result.place_id);
    const placeDetail = detailMap.get(result.place_id);
    
    console.log(`[DEBUG] place_id ${result.place_id} 매핑:`, {
      hasPlace: !!place,
      placeName: place?.place_name,
      category: place?.category,
      hasDetail: !!placeDetail,
      detailCrawledAt: placeDetail?.created_at,
      blogReviewCount: placeDetail?.blog_review_count,
      receiptReviewCount: placeDetail?.receipt_review_count,
      savedCount: placeDetail?.savedCount
    });
    
    return {
      id: result.id,
      keyword_id: result.keyword_id,
      keyword: keyword,
      isRestaurant: keywordRecord.isRestaurant,
      ranking: result.ranking,
      place_id: result.place_id,
      place_name: result.place_name || `업체명없음_${result.place_id}`, // 크롤링 결과에서 직접 가져오기
      category: result.category || '업종없음', // 크롤링 결과에서 직접 가져오기
      blog_review_count: placeDetail ? placeDetail.blog_review_count : null,
      receipt_review_count: placeDetail ? placeDetail.receipt_review_count : null,
      savedCount: placeDetail ? placeDetail.savedCount : null,
      saved_count: placeDetail ? placeDetail.savedCount : null,
      keywordList: placeDetail ? placeDetail.keywordList : null,
      crawled_at: result.last_crawled_at,
      date_key: targetDateString,
      date: targetDateString
    };
  });

  console.log(`[DEBUG] JOIN 쿼리 최적화 사용 - 총 ${finalResults.length}개 업체 정보 처리 완료`);
  console.log(`[DEBUG] 키워드 "${keyword}" isRestaurant: ${keywordRecord.isRestaurant}`);
  console.log(`[DEBUG] 첫 번째 결과 샘플:`, finalResults[0] ? {
    place_name: finalResults[0].place_name,
    category: finalResults[0].category,
    savedCount: finalResults[0].savedCount,
    isRestaurant: finalResults[0].isRestaurant
  } : '결과 없음');

  // 9. 결과 반환
  return {
    rankingDetails: finalResults,
    rankingList: finalResults, // 호환성을 위해 동일한 데이터
    chartData: finalResults, // 차트 데이터로도 사용 가능
    metadata: {
      keyword: keyword,
      isRestaurant: keywordRecord.isRestaurant, // 키워드의 레스토랑 여부 추가
      totalCount: finalResults.length,
      targetDate: targetDateString,
      placeId: placeId,
      rangeValue: parseInt(rangeValue),
      hasData: true
    }
  };
};

/**
 * 메인 키워드 변경
 */
export const updateMainKeywordHandler = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({ 
    controllerName: 'KeywordController', 
    actionName: 'updateMainKeyword' 
  });
  
  try {
    const { placeId } = req.params;
    const { keywordId } = req.body;
    const userId = req.user?.id || req.user?.userId;
    
    controllerLogger.info(`메인 키워드 변경 요청 - placeId: ${placeId}, keywordId: ${keywordId}, userId: ${userId}`);
    
    const validationError = validateRequiredFields({ placeId, keywordId }, ['placeId', 'keywordId']);
    if (validationError) {
      const error = new Error(validationError.message);
      error.statusCode = 400;
      throw error;
    }
    
    // 트랜잭션으로 처리
    const result = await handleDbOperation(async () => {
      return sequelize.transaction(async (t) => {
        // 1. 업체가 사용자 소유인지 확인
        const place = await Place.findOne({
          where: { 
            place_id: placeId,
            user_id: userId 
          },
          transaction: t
        });
        
        if (!place) {
          throw new Error('업체를 찾을 수 없거나 권한이 없습니다.');
        }
        
        // 2. 키워드가 해당 업체에 등록되어 있는지 확인
        const userPlaceKeyword = await UserPlaceKeyword.findOne({
          where: {
            user_id: userId,
            place_id: placeId,
            keyword_id: keywordId
          },
          transaction: t
        });
        
        if (!userPlaceKeyword) {
          throw new Error('해당 업체에 등록되지 않은 키워드입니다.');
        }
        
        // 3. 기존 메인 키워드 해제
        await UserPlaceKeyword.update(
          { isMain: 0 },
          {
            where: {
              user_id: userId,
              place_id: placeId,
              isMain: 1
            },
            transaction: t
          }
        );
        
        // 4. 새로운 메인 키워드 설정
        await UserPlaceKeyword.update(
          { isMain: 1 },
          {
            where: {
              user_id: userId,
              place_id: placeId,
              keyword_id: keywordId
            },
            transaction: t
          }
        );
        
        return { success: true };
      });
    }, "메인 키워드 변경");
    
    controllerLogger.info(`메인 키워드 변경 완료 - placeId: ${placeId}, keywordId: ${keywordId}`);
    return { message: '메인 키워드가 성공적으로 변경되었습니다.' };
    
  } catch (error) {
    controllerLogger.error('메인 키워드 변경 실패:', error);
    throw error;
  }
};