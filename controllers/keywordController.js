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
// 수정: sequelize와 Op 올바르게 import
import sequelize from "../config/db.js";
import { Op } from "sequelize";
// 추가: 크롤러 서비스 임포트
import { crawlKeywordBasic } from "../services/crawler/basicCrawlerService.js";
import { createLogger } from '../lib/logger.js';
import { keywordQueue } from "../services/crawler/keywordQueue.js";
import { addUserBasicJob } from "../services/crawler/keywordQueue.js"; // 추가: 키워드 큐 함수 임포트
import { checkIsRestaurantByDOM } from "../services/isRestaurantChecker.js"; // 추가: isRestaurant 확인 함수 임포트

const logger = createLogger('KeywordControllerLogger');
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
    console.error('[ERROR] checkPlaceExists:', error);
    // 에러 발생 시 false 반환 (정상 흐름 유지)
    return false;
  }
}

export async function normalizeUrlHandler(req, res) {
  try {
    logger.info('[INFO] normalizeUrlHandler body:', req.body);
    const { url, platform, userId } = req.body;
    if (platform !== "naver") {
      return res.status(400).json({ success: false, message: "현재는 NAVER 플랫폼만 지원합니다." });
    }
    if (!url) {
      return res.status(400).json({ success: false, message: "url 파라미터가 필요합니다." });
    }

    const normalizedUrl = await normalizePlaceUrl(url);
    if (!normalizedUrl) {
      return res
        .status(400)
        .json({ success: false, message: "URL을 정규화할 수 없습니다." });
    }

    // (1) 장소 정보 가져오기
    const placeInfo = await getNaverPlaceFullInfo(normalizedUrl)

    // (2) Passport JWT 인증이 붙어 있다면, 여기서 req.user가 존재
    //     userId를 placeInfo에 추가하여 프론트로 전달
    const authenticatedUserId = req.user?.id || userId;
    if (!authenticatedUserId) {
      // 혹은 필요 시 401 리턴
      return res.status(401).json({
        success: false,
        message: "인증되지 않은 사용자입니다.",
      });
    }
    
    // placeInfo에 userid 필드로 넣기
    placeInfo.userid = authenticatedUserId;

    // (3) 장소 ID 추출 - normalizePlaceUrl에서 이미 추출되었으므로, 여기서 다시 추출
    // URL에서 place_id 추출 (restaurant/12345678 또는 place/12345678 형식에서)
    const match = normalizedUrl.match(/(?:place\/|restaurant\/|cafe\/|\/)(\d+)(?:\/|$|\?)/);
    if (!match) {
      return res.status(400).json({ 
        success: false, 
        message: "URL에서 place ID를 추출할 수 없습니다." 
      });
    }
    const placeId = match[1];

    // (4) DB에서 이미 등록된 place_id인지 확인
    const alreadyRegistered = await checkPlaceExists(authenticatedUserId, placeId);

    logger.info(`[INFO] Normalized URL = ${normalizedUrl}`);
    logger.info(`[INFO] Place Info = ${JSON.stringify(placeInfo)}`);
    logger.info(`[INFO] Already Registered = ${alreadyRegistered}`);
    
    return res.json({
      success: true,
      normalizedUrl,
      placeInfo,
      alreadyRegistered // 중복 등록 여부 플래그 추가
    });
  } catch (err) {
    logger.error("[ERROR] normalizeUrlHandler:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}


/** 
 * 2) places 테이블에 저장 
 *    POST /analysis/store-place
 */
export async function storePlaceHandler(req, res) {
  try {
    logger.info('storePlaceHandler body =', req.body)
    const { user_id, place_id, place_name, category, platform } = req.body
    if (!user_id || !place_id || !place_name) {
      return res.status(400).json({
        success: false,
        message: "user_id, place_id, place_name은 필수입니다.",
      })
    }

    // (A) 중복 체크
    const existing = await Place.findOne({ where: { user_id, place_id } })
    if (existing) {
      logger.info(
        `[INFO] place_id=${place_id} is already registered for user_id=${user_id}, skipping creation.`
      )
      return res.json({ success: true, message: "이미 등록된 place이므로 새로 생성하지 않았습니다." })
    }

    // (B) DB 저장
    await Place.create({ user_id, place_id, place_name, category })
    logger.info(`[INFO] Stored place = ${place_name} (${place_id}) for user ${user_id}`)
    return res.json({ success: true })
  } catch (err) {
    logger.error("[ERROR] storePlaceHandler:", err)
    return res.status(500).json({ success: false, message: err.message })
  }
}
/**
 * 3) ChatGPT 키워드 생성
 *    POST /analysis/chatgpt
 */
export async function chatgptKeywordsHandler(req, res) {
  try {
    const { placeInfo } = req.body
    // placeInfo에는 { shopIntro, blogReviewTitles... } 등 정보가 있다고 가정

    // URL에서 restaurant 여부 확인
    const isRestaurant = placeInfo.normalizedUrl && 
                          placeInfo.normalizedUrl.includes("restaurant") ? true : false
    
    // placeInfo에 isRestaurant 정보 추가
    const placeInfoWithType = {
      ...placeInfo,
      isRestaurant
    }

    // ChatGPT 분석 (isRestaurant 정보 포함하여 전달)
    const { locationKeywords, featureKeywords } = await analyzePlaceWithChatGPT(placeInfoWithType)

    // 혹은 category 쓰일 수 있음
    if (!locationKeywords.length && !featureKeywords.length) {
      // 빈 값이라도 일단 응답
      return res.json({ success: true, locationKeywords: [], featureKeywords: [] })
    }
    logger.info(`[INFO] ChatGPT Keywords: ${locationKeywords}, ${featureKeywords}`)
    return res.json({
      success: true,
      locationKeywords,
      featureKeywords,
    })
  } catch (err) {
    logger.error("[ERROR] chatgptKeywordsHandler:", err)
    return res.status(500).json({ success: false, message: err.message })
  }
}

// (B) Express 라우트 핸들러
export async function combineLocationAndFeaturesHandler(req, res) {
  try {
    logger.debug("[DEBUG] /keyword/combine req.body =", req.body)
    // 1) req.body 로부터 locationKeywords, featureKeywords 추출
    const { locationKeywords, featureKeywords } = req.body

    // 2) validation
    if (!Array.isArray(locationKeywords) || !Array.isArray(featureKeywords)) {
      return res.status(400).json({
        success: false,
        message: "locationKeywords, featureKeywords must be arrays",
      })
    }
    // (A) 순수 로직 함수
    function combineLocationAndFeatures({ locationKeywords, featureKeywords }) {
      const combinedSet = new Set()
      for (const loc of locationKeywords) {
        for (const feat of featureKeywords) {
          const keyword = loc + feat
          combinedSet.add(keyword)
        }
      }
      // 최대 100개만
      return Array.from(combinedSet).slice(0, 100)
    }

    // 3) 위에서 만든 순수 로직 함수 호출
    const finalArr = combineLocationAndFeatures({ locationKeywords, featureKeywords })

    // 4) 응답
    return res.json({
      success: true,
      candidateKeywords: finalArr,
    })
  } catch (err) {
    logger.error("[ERROR] combineLocationAndFeaturesHandler:", err)
    return res.status(500).json({ success: false, message: err.message })
  }
}

/**
 * 5) 검색광고 API 조회 (검색량)
 *    POST /analysis/search-volume
 *    body: { candidateKeywords: string[] }
 */
export async function searchVolumesHandler(req, res) {
  try {
    // 1) candidateKeywords와 normalizedUrl 읽기
    const { candidateKeywords, normalizedUrl } = req.body;

    const isRestaurant = normalizedUrl && normalizedUrl.includes("restaurant") ? 1 : 0;

    if (!Array.isArray(candidateKeywords)) {
      return res.status(400).json({
        success: false,
        message: "candidateKeywords must be an array",
      });
    }

    // 3) 검색광고 API 조회
    const externalDataList = await getSearchVolumes(candidateKeywords);
    logger.info(`[INFO] External Data List: ${JSON.stringify(externalDataList)}`);

    // 필터: 검색량 null 또는 200 미만인 키워드는 제외
    const filteredDataList = externalDataList.filter(d => typeof d.monthlySearchVolume === 'number' && d.monthlySearchVolume >= 200);

    // 4) DB 저장/업데이트 (필터된 리스트만)
    await Promise.all(
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

    // 5) 응답 (필터된 리스트만 반환)
    return res.json({
      success: true,
      externalDataList: filteredDataList
    });
  } catch (err) {
    logger.error("[ERROR] searchVolumesHandler:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}

/**
 * 6) 키워드 그룹핑
 *    POST /analysis/group
 *    body: { externalDataList: { keyword, monthlySearchVolume }[] }
 */
export async function groupKeywordsHandler(req, res) {
  try {
    const { externalDataList } = req.body;
    if (!externalDataList || !Array.isArray(externalDataList)) {
      return res.status(400).json({
        success: false,
        message: "externalDataList 배열 필요",
      });
    }

    // 클라이언트 타임아웃 방지를 위해 처리할 키워드 수 제한
    const MAX_KEYWORDS = 20; // 안정적으로 처리 가능한 수로 감소
    const limitedKeywords = externalDataList.slice(0, MAX_KEYWORDS);
    
    if (limitedKeywords.length < externalDataList.length) {
      logger.info(`[INFO] 너무 많은 키워드가 요청됨. ${externalDataList.length}개 중 ${MAX_KEYWORDS}개만 처리합니다.`);
    }
    
    // 항상 동기적으로 처리 (비동기 처리 제거)
    const finalKeywords = await groupKeywordsByNaverTop10(limitedKeywords);
    
    // 모든 그룹을 저장 (단일 키워드 그룹 포함)
    if (finalKeywords && finalKeywords.length > 0) {
      await saveAllKeywordGroupsLogic(finalKeywords);
      logger.info(`[INFO] 키워드 그룹화 완료: ${finalKeywords.length}개 그룹 생성`);
      
      // 그룹화 결과 반환 (모든 케이스에서 동일한 형식)
      return res.json({
        success: true,
        message: `키워드 그룹화 완료: ${finalKeywords.length}개 그룹 생성`,
        finalKeywords,
      });
    } else {
      return res.json({
        success: true,
        message: "그룹화된 키워드가 없습니다.",
        finalKeywords: [],
      });
    }
  } catch (err) {
    logger.error("[ERROR] groupKeywordsHandler:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
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
export async function saveGroupedKeywordsHandler(req, res) {
  try {
    const { finalKeywords } = req.body;
    if (!Array.isArray(finalKeywords)) {
      return res.status(400).json({
        success: false,
        message: "finalKeywords 배열이 필요합니다.",
      });
    }

    // 바로 로직 함수 호출
    await saveGroupedKeywordsLogic(finalKeywords);

    logger.info("[INFO] Grouped keywords saved.");
    return res.json({ success: true, message: "Grouped keywords saved." });
  } catch (err) {
    logger.error("[ERROR] saveGroupedKeywordsHandler:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 7) 선택된 키워드 저장
 *    POST /keyword/save-selected
 *    body: { placeId: number, keywords: string[] }
 *    Authentication: JWT (req.user)
 */
export async function saveSelectedKeywordsHandler(req, res) {
  try {
    const user_id = req.user.id;
    logger.info('[INFO] 요청 데이터:', { user_id, ...req.body });
    const { placeId, keywords } = req.body;
    const place_id = placeId;

    // Fetch existing Place record
    const placeRecord = await Place.findOne({ where: { user_id, place_id } });
    if (!placeRecord) {
      return res.status(400).json({ success: false, message: '먼저 장소를 저장해주세요.' });
    }

    if (!keywords || !Array.isArray(keywords)) {
      return res.status(400).json({ 
        success: false, 
        message: 'keywords 배열이 필요합니다' 
      });
    }

    // 1) 입력된 키워드를 DB(Keyword 테이블)에 저장
    // (D) UserPlaceKeyword 테이블 연동 will use placeRecord.place_id
    //    - 그룹화 키워드 등 처리 포함
    const createdIds = [];
    const groupedKeywords = [];

    for (const keywordObj of keywords) {
      let keywordText;
      let isGrouped = false;
      let groupKeywords = [];

      // (A) 다양한 형식의 keywordObj 처리
      if (typeof keywordObj === 'string') {
        keywordText = keywordObj;
      } else if (keywordObj.text) {
        keywordText = keywordObj.text;
      } else if (keywordObj.keyword) {
        keywordText = keywordObj.keyword;
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
      createdIds.push(keywordRecord.id);

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
        defaults: { user_id, place_id, keyword_id: keywordRecord.id }
      });
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

    return res.json({
      success: true,
      message: `${createdIds.length}개 키워드가 저장되고, 필요 시 크롤링이 진행됩니다.`,
    });
  } catch (err) {
    logger.error('[ERROR] saveSelectedKeywordsHandler:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}


// 키워드 추가 핸들러 - isRestaurant 확인, 검색량 조회 및 저장 개선
export const addUserKeywordHandler = async (req, res) => {
  try {
    const { userId, placeId, keyword } = req.body;

    if (!userId || !placeId || !keyword) {
      return res.status(400).json({ message: "필수 필드가 누락되었습니다." });
    }

    // 1. 키워드 레코드 찾기
    let keywordRecord = await Keyword.findOne({ where: { keyword } });
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
      await checkIsRestaurantByDOM(keyword);
      
      // 2-3. checkIsRestaurantByDOM은 내부적으로 키워드를 생성하므로, 다시 조회
      keywordRecord = await Keyword.findOne({ where: { keyword } });
      
      if (!keywordRecord) {
        return res.status(500).json({ message: "키워드 생성 중 오류가 발생했습니다." });
      }

      // 2-4. 검색량 정보 업데이트
      if (searchVolume > 0) {
        await keywordRecord.update({
          last_search_volume: searchVolume,
          monthlySearchVolume: searchVolume
        });
        logger.info(`[INFO] 키워드 "${keyword}" 검색량(${searchVolume}) 저장 완료`);
      }
      
      logger.info(`[INFO] 새 키워드 "${keyword}" 생성됨, isRestaurant=${keywordRecord.isRestaurant}, searchVolume=${searchVolume}`);
    }

    // 3. 새로 생성된 키워드인 경우 크롤링 시도하여 유효성 확인
    if (created) {
      try {
        logger.info(`[INFO] 새 키워드 "${keyword}" 유효성 확인을 위한 테스트 크롤링 시작`);
        
        // 키워드 크롤링 실행 - 결과가 있는지 확인
        const items = await crawlKeywordBasic(keyword, keywordRecord.id);
        
        // 결과가 없으면 "조건에 맞는 업체가 없음" 상태
        if (!items || items.length === 0) {
          logger.warn(`[WARN] 키워드 "${keyword}": 조건에 맞는 업체가 없습니다. 키워드 추가 취소.`);
          
          // 새로 생성된 키워드 레코드 삭제 (관련 데이터 정리)
          if (keywordRecord) {
            await keywordRecord.destroy();
            logger.info(`[INFO] 새 키워드 "${keyword}" 삭제됨 (유효하지 않은 키워드)`);
          }
          
          return res.status(400).json({ 
            message: "조건에 맞는 업체가 없습니다. 다른 키워드를 사용해주세요." 
          });
        }
        
        logger.info(`[INFO] 키워드 "${keyword}" 유효성 확인 완료 (${items.length}개 항목 발견)`);
      } catch (crawlError) {
        logger.error(`[ERROR] 키워드 "${keyword}" 크롤링 테스트 중 오류:`, crawlError);
        
        // 크롤링 오류 발생 시 새 키워드 삭제하고 오류 반환
        if (keywordRecord) {
          await keywordRecord.destroy();
          logger.info(`[INFO] 새 키워드 "${keyword}" 삭제됨 (크롤링 오류)`);
        }
        
        return res.status(500).json({ 
          message: "키워드 유효성 확인 중 오류가 발생했습니다. 다시 시도해주세요." 
        });
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
    const [userKeywordRelation, relationCreated] = await UserPlaceKeyword.findOrCreate({
      where: { user_id: userId, place_id: placeId, keyword_id: keywordRecord.id },
      defaults: { user_id: userId, place_id: placeId, keyword_id: keywordRecord.id },
    });

    if (!relationCreated) {
      // 이미 존재하는 경우
      logger.info(`[INFO] 사용자 ${userId}의 업체 ${placeId}에 키워드 "${keyword}"가 이미 연결되어 있습니다.`);
    }

    res.status(201).json({ 
      message: "키워드가 성공적으로 추가되었습니다.",
      keyword: {
        id: keywordRecord.id,
        keyword: keywordRecord.keyword,
        isRestaurant: keywordRecord.isRestaurant,
        search_volume: keywordRecord.last_search_volume, // 검색량 정보 추가
        relation_id: userKeywordRelation.id
      }
    });
  } catch (error) {
    console.error("키워드 추가 중 오류 발생:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 키워드 변경 핸들러 - isRestaurant 확인, 검색량 조회 및 저장 개선
export const changeUserKeywordHandler = async (req, res) => {
  try {
    const { userId, placeId, oldKeywordId, newKeyword } = req.body;

    if (!userId || !placeId || !oldKeywordId || !newKeyword || !newKeyword.trim()) {
      return res.status(400).json({ message: "필수 필드가 누락되었습니다." });
    }

    // 1. UserPlaceKeyword 테이블에서 기존 연결 찾기
    const userKeyword = await UserPlaceKeyword.findOne({
      where: {
        user_id: userId,
        place_id: placeId,
        keyword_id: oldKeywordId
      }
    });

    if (!userKeyword) {
      return res.status(404).json({ message: "해당 키워드 연결을 찾을 수 없습니다." });
    }

    // 2. Keyword 테이블에서 새 키워드 찾기
    const trimmedKeyword = newKeyword.trim();
    let newKeywordRecord = await Keyword.findOne({ where: { keyword: trimmedKeyword } });
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
      newKeywordRecord = await Keyword.findOne({ where: { keyword: trimmedKeyword } });
      
      if (!newKeywordRecord) {
        return res.status(500).json({ message: "키워드 생성 중 오류가 발생했습니다." });
      }
      
      // 3-4. 검색량 정보 업데이트
      if (searchVolume > 0) {
        await newKeywordRecord.update({
          last_search_volume: searchVolume,
          monthlySearchVolume: searchVolume
        });
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
          await newKeywordRecord.update({
            last_search_volume: searchVolume,
            monthlySearchVolume: searchVolume
          });
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
          
          return res.status(400).json({ 
            message: "조건에 맞는 업체가 없습니다. 다른 키워드를 사용해주세요." 
          });
        }
        
        logger.info(`[INFO] 키워드 "${trimmedKeyword}" 유효성 확인 완료 (${items.length}개 항목 발견)`);
      } catch (crawlError) {
        logger.error(`[ERROR] 키워드 "${trimmedKeyword}" 크롤링 테스트 중 오류:`, crawlError);
        
        // 크롤링 오류 발생 시 새 키워드 삭제하고 오류 반환
        if (newKeywordRecord) {
          await newKeywordRecord.destroy();
          logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" 삭제됨 (크롤링 오류)`);
        }
        
        return res.status(500).json({ 
          message: "키워드 유효성 확인 중 오류가 발생했습니다. 다시 시도해주세요." 
        });
      }
    }

    // 5. UserPlaceKeyword 테이블에서 새 키워드로 이미 연결이 있는지 확인
    const existingRelation = await UserPlaceKeyword.findOne({
      where: {
        user_id: userId,
        place_id: placeId,
        keyword_id: newKeywordRecord.id
      }
    });

    // 6. 기존 연결 삭제
    await userKeyword.destroy();

    // 7. 새 연결이 없는 경우에만 생성 (중복 방지)
    let userKeywordRelation;
    if (!existingRelation) {
      userKeywordRelation = await UserPlaceKeyword.create({
        user_id: userId,
        place_id: placeId,
        keyword_id: newKeywordRecord.id
      });
    } else {
      userKeywordRelation = existingRelation;
    }

    // 8. Basic 크롤링이 수행되었으므로, 필요한 경우 Detail 크롤링을 예약
    if (created) {
      logger.info(`[INFO] 새 키워드 "${trimmedKeyword}" detail 크롤링 큐에 추가`);
      // Detail 크롤링은 이미 Basic 크롤링 내부에서 처리되었음
    }

    res.status(200).json({ 
      message: "키워드가 성공적으로 변경되었습니다.",
      keyword: {
        id: newKeywordRecord.id,
        keyword: newKeywordRecord.keyword,
        relation_id: userKeywordRelation.id,
        isRestaurant: newKeywordRecord.isRestaurant,
        search_volume: newKeywordRecord.last_search_volume // 검색량 정보 추가
      }
    });
  } catch (error) {
    console.error("키워드 변경 중 오류 발생:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

/**
 * 키워드 크롤링 상태 확인 엔드포인트
 * GET /keyword/status/:keywordId 또는 ?keyword=키워드명
 */
export async function getKeywordStatusHandler(req, res) {
  try {
    const { keywordId } = req.params;
    const { keyword } = req.query;
    
    if (!keywordId && !keyword) {
      return res.status(400).json({
        success: false,
        message: "키워드 ID나 키워드명이 필요합니다."
      });
    }
    
    // 키워드 검색 (ID 또는 이름으로)
    let keywordRecord;
    if (keywordId) {
      keywordRecord = await Keyword.findByPk(keywordId);
    } else if (keyword) {
      keywordRecord = await Keyword.findOne({ where: { keyword } });
    }
    
    if (!keywordRecord) {
      return res.status(404).json({
        success: false,
        message: "키워드를 찾을 수 없습니다."
      });
    }
    
    // 키워드 기본 크롤링 상태 확인
    const isCrawled = !!keywordRecord.basic_last_crawled_date;
    const lastCrawledDate = keywordRecord.basic_last_crawled_date;
    
    // 크롤링된 항목 수 가져오기
    const crawledItemsCount = await KeywordBasicCrawlResult.count({
      where: { keyword_id: keywordRecord.id }
    });
    
    // 응답 준비
    const currentTime = new Date();
    let status = "not_crawled";
    let timeAgo = null;
    
    if (isCrawled) {
      // 크롤링된 시간과 현재 시간의 차이 계산
      const timeDiff = currentTime - new Date(lastCrawledDate);
      const minutesAgo = Math.floor(timeDiff / (1000 * 60));
      
      if (minutesAgo < 60) {
        timeAgo = `${minutesAgo}분 전`;
      } else {
        const hoursAgo = Math.floor(minutesAgo / 60);
        if (hoursAgo < 24) {
          timeAgo = `${hoursAgo}시간 전`;
        } else {
          const daysAgo = Math.floor(hoursAgo / 24);
          timeAgo = `${daysAgo}일 전`;
        }
      }
      
      status = "completed";
    }
    
    return res.json({
      success: true,
      data: {
        keyword: keywordRecord.keyword,
        isRestaurant: keywordRecord.isRestaurant,
        status,
        lastCrawled: lastCrawledDate,
        timeAgo,
        crawledItemsCount,
        monthlySearchVolume: keywordRecord.monthlySearchVolume
      }
    });
  } catch (err) {
    logger.error("[ERROR] getKeywordStatusHandler:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

export async function getMainKeywordStatusHandler(req, res) {
  try {
    const userId = req.user.id;
    // place_id를 쿼리 파라미터로 받음
    const selectedPlaceId = req.query.place_id;
    
    // 선택된 place_id가 있으면 사용, 없으면 사용자의 첫 번째 업체 가져오기
    let placeId;
    
    if (selectedPlaceId) {
      // 요청된 place_id가 유효한지 확인
      const validUserPlace = await UserPlaceKeyword.findOne({ 
        where: { user_id: userId, place_id: selectedPlaceId } 
      });
      
      if (!validUserPlace) {
        return res.status(404).json({ 
          success: false, 
          message: 'This place does not belong to the user' 
        });
      }
      
      placeId = selectedPlaceId;
      logger.info(`[INFO] getMainKeywordStatusHandler: Using requested place_id=${placeId}`);
    } else {
      // 기존 로직: 첫 번째 업체 사용
      const userPlace = await UserPlaceKeyword.findOne({ where: { user_id: userId } });
      if (!userPlace) return res.status(404).json({ success: false, message: 'No place found for user' });
      placeId = userPlace.place_id;
      logger.info(`[INFO] getMainKeywordStatusHandler: Using first place_id=${placeId}`);
    }
    
    // 해당 place_id에 연결된 모든 키워드 조회
    const userKeywords = await UserPlaceKeyword.findAll({ 
      where: { user_id: userId, place_id: placeId }
    });
    
    if (!userKeywords.length) return res.status(404).json({ success: false, message: 'No keywords found' });
    
    // 키워드 ID 목록 추출
    const keywordIds = userKeywords.map(uk => uk.keyword_id);
    
    // 해당 키워드들 직접 조회
    const keywords = await Keyword.findAll({
      where: { id: keywordIds }
    });
    
    if (!keywords.length) return res.status(404).json({ success: false, message: 'No keywords found' });
    
    // Determine main keyword by highest last_search_volume
    const mainKeyword = keywords.sort((a,b) => (b.last_search_volume || 0) - (a.last_search_volume || 0))[0];
    const keywordId = mainKeyword.id;
    const keywordText = mainKeyword.keyword;
    
    // 현재 시간 확인
    const now = new Date();
    const today14h = new Date(now);
    today14h.setHours(14, 0, 0, 0);
    
    // 오늘이 14시 이전인지 확인
    const isBefore14h = now < today14h;
    
    // 날짜 계산 - 오늘, 어제, 그저께
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const dayBeforeYesterday = new Date(yesterday);
    dayBeforeYesterday.setDate(yesterday.getDate() - 1);
    
    // 각 날짜의 시작과 끝 설정
    function getDateRange(date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    
    const todayRange = getDateRange(today);
    const yesterdayRange = getDateRange(yesterday);
    const dayBeforeYesterdayRange = getDateRange(dayBeforeYesterday);
    
    // 각 날짜별 최신 크롤링 결과 조회
    const getLatestResult = async (dateRange) => {
      return await KeywordBasicCrawlResult.findOne({ 
        where: { 
          keyword_id: keywordId, 
          place_id: placeId,
          last_crawled_at: {
            [Op.between]: [dateRange.start, dateRange.end]
          }
        },
        order: [['last_crawled_at', 'DESC']]
      });
    };
    
    // 날짜별 결과 조회
    const todayResult = await getLatestResult(todayRange);
    const yesterdayResult = await getLatestResult(yesterdayRange);
    const dayBeforeYesterdayResult = await getLatestResult(dayBeforeYesterdayRange);
    
    let currentRank = null;
    let prevRank = null;
    let diff = null;
    
    // 14시 이전이라면 어제와 그저께 데이터 사용
    if (isBefore14h) {
      logger.info('[INFO] 현재 14시 이전이므로 어제/그저께 데이터를 사용합니다.');
      currentRank = yesterdayResult ? yesterdayResult.ranking : null;
      prevRank = dayBeforeYesterdayResult ? dayBeforeYesterdayResult.ranking : null;
    } else {
      // 14시 이후라면 오늘과 어제 데이터 사용
      currentRank = todayResult ? todayResult.ranking : null;
      
      // 오늘 데이터가 없으면 어제 데이터를 현재로 사용
      if (!currentRank && yesterdayResult) {
        logger.info('[INFO] 오늘 크롤링 데이터가 없어 어제 데이터를 현재로 사용합니다.');
        currentRank = yesterdayResult.ranking;
        prevRank = dayBeforeYesterdayResult ? dayBeforeYesterdayResult.ranking : null;
      } else {
        // 정상적으로 오늘 데이터가 있는 경우
        prevRank = yesterdayResult ? yesterdayResult.ranking : null;
      }
    }
    
    // 순위 변화 계산 (이전 순위 - 현재 순위 = 양수면 상승, 음수면 하락)
    diff = (prevRank !== null && currentRank !== null) ? prevRank - currentRank : null;
    
    // 사용된 데이터 로깅
    logger.info(`[INFO] 업체 ${placeId} 키워드 "${keywordText}" 순위 정보 - 현재: ${currentRank}, 이전: ${prevRank}, 변화: ${diff}`);
    
    return res.json({ success: true, data: { keyword: keywordText, currentRank, diff } });
  } catch(err) {
    console.error('[ERROR] getMainKeywordStatusHandler:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// 업체별 키워드 순위 조회 API
export async function getKeywordRankingsByBusinessHandler(req, res) {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다."
      });
    }
    
    // 1. 사용자의 모든 업체 조회
    const places = await Place.findAll({
      where: { user_id: userId },
      attributes: ['place_id', 'place_name', 'category']
    });
    
    if (!places || places.length === 0) {
      return res.json({
        success: true,
        data: {}
      });
    }
    
    // 2. 각 업체별로 등록된 키워드와 해당 순위 정보 수집
    const result = {};
    
    for (const place of places) {
      const placeId = place.place_id;
      
      // 해당 업체에 연결된 키워드 조회
      const userPlaceKeywords = await UserPlaceKeyword.findAll({
        where: { user_id: userId, place_id: placeId },
        include: [
          { model: Keyword, attributes: ['id', 'keyword'] }
        ]
      });
      
      if (!userPlaceKeywords || userPlaceKeywords.length === 0) {
        // 등록된 키워드가 없는 경우 빈 배열로 설정
        result[placeId] = {
        };
        continue;
      }
      
      // 키워드별 최신 순위 정보 수집
      const keywordsWithRanking = await Promise.all(
        userPlaceKeywords.map(async (upk) => {
          const keywordId = upk.keyword_id;
          
          // Keyword가 null인 경우 처리
          if (!upk.Keyword) {
            // Keyword 직접 조회
            const keywordRecord = await Keyword.findByPk(keywordId);
            const keyword = keywordRecord ? keywordRecord.keyword : `키워드 ID: ${keywordId}`;
            
            // 해당 키워드의 최신 크롤링 결과 조회
            const latestResult = await KeywordBasicCrawlResult.findOne({
              where: { 
                keyword_id: keywordId,
                place_id: placeId
              },
              order: [['last_crawled_at', 'DESC']]
            });
            
            return {
              keyword,
              ranking: latestResult ? latestResult.ranking : null
            };
          }
          
          const keyword = upk.Keyword.keyword;
          
          // 해당 키워드의 최신 크롤링 결과 조회
          const latestResult = await KeywordBasicCrawlResult.findOne({
            where: { 
              keyword_id: keywordId,
              place_id: placeId
            },
            order: [['last_crawled_at', 'DESC']]
          });
          
          return {
            keyword,
            ranking: latestResult ? latestResult.ranking : null
          };
        })
      );
      
      // 결과 객체에 추가
      result[placeId] = {
        place_name: place.place_name,
        category: place.category,
        keywords: keywordsWithRanking
      };
    }
    
    return res.json({
      success: true,
      data: result
    });
    
  } catch (err) {
    logger.error("[ERROR] getKeywordRankingsByBusinessHandler:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}