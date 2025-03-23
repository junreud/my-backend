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
// 추가: sequelize 임포트 (raw query 사용)
import sequelize from "../config/db.js";
// 추가: 크롤러 서비스 임포트
import { crawlKeywordBasic } from "../services/crawler/basicCrawlerService.js";
import { detailQueue, addUserSelectedKeywordJob } from "../services/crawler/keywordQueue.js";
import { createLogger } from '../lib/logger.js';
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

    // (A) 중복 체크: 이미 동일한 (user_id, place_id)가 존재하면
    const existing = await Place.findOne({ where: { user_id, place_id } })
    if (existing) {
      // 기존에는 400 에러를 보냈지만, 이제는 메시지와 함께 성공 응답을 돌려줍니다.
      logger.info(
        `[INFO] place_id=${place_id} is already registered for user_id=${user_id}, skipping creation.`
      )
      return res.json({
        success: true,
        message: "이미 등록된 place이므로 새로 생성하지 않았습니다.",
      })
    }

    // (B) DB 저장
    await Place.create({
      user_id,
      place_id,
      place_name,
      category,
    })

    logger.info(`[INFO] Stored place = ${place_name} (${place_id}) by user ${user_id}`)
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

    // ChatGPT 분석
    const { locationKeywords, featureKeywords } = await analyzePlaceWithChatGPT(placeInfo)

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
    // 1) candidateKeywords 배열
    const { candidateKeywords } = req.body;
    // 2) ?normalizedUrl=... 쿼리 파라미터로부터 isRestaurant 계산
    const { normalizedUrl } = req.query;
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

    // 4) DB 저장/업데이트
    await Promise.all(
      externalDataList.map(async (data) => {
        const { keyword, monthlySearchVolume } = data;
        if (!keyword) return;

        // DB에서 keyword 일치 여부 확인
        let keywordRecord = await Keyword.findOne({ where: { keyword } });
        if (keywordRecord) {
          // 이미 있으면 monthlySearchVolume, last_search_volume 및 isRestaurant 업데이트
          await keywordRecord.update({
            monthlySearchVolume,
            last_search_volume: monthlySearchVolume,
          
          });
        } else {
          // 없으면 새로 생성
          await Keyword.create({
            keyword,
            monthlySearchVolume,
            last_search_volume: monthlySearchVolume,
            isRestaurant,
          });
        }
      })
    );

    // 5) 응답
    return res.json({
      success: true,
      externalDataList,
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
 * 단일 키워드 그룹도 포함하여 저장
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
 * POST /keyword/save-selected
 * body: { keywords: ['강원막국수', '강촌역맛집', ...] }
 */
/**
 * POST /keyword/save-selected
 * body: { keywords: ['강원막국수', '강촌역맛집', ...] }
 */
export async function saveSelectedKeywordsHandler(req, res) {
  try {
    logger.info('[INFO] 요청 데이터:', req.body);
    
    const { user_id, place_id, finalKeywords } = req.body;
    
    if (!finalKeywords || !Array.isArray(finalKeywords)) {
      return res.status(400).json({ 
        success: false, 
        message: 'finalKeywords 배열이 필요합니다' 
      });
    }
    
    // 키워드 처리 및 저장
    const createdIds = [];
    // 그룹화된 키워드 저장용 배열
    const groupedKeywords = [];
    
    // [기존 코드 유지: 키워드 추출 및 Keyword 테이블 저장]
    for (const keywordObj of finalKeywords) {
      // combinedKeyword 처리 개선
      let keywordText;
      let isGrouped = false;
      let groupKeywords = [];
      
      if (typeof keywordObj === 'string') {
        keywordText = keywordObj;
      } else if (keywordObj.text) {
        keywordText = keywordObj.text;
      } else if (keywordObj.keyword) {
        keywordText = keywordObj.keyword;
      } else if (keywordObj.combinedKeyword) {
        // 그룹화된 키워드 형식 처리
        const splitKeywords = keywordObj.combinedKeyword.split(',').map(k => k.trim()).filter(k => k);
        
        if (splitKeywords.length > 1) {
          isGrouped = true;
          groupKeywords = splitKeywords;
          keywordText = splitKeywords[0]; // 첫 번째 키워드 사용
        } else if (splitKeywords.length === 1) {
          keywordText = splitKeywords[0];
        } else {
          keywordText = keywordObj.combinedKeyword;
        }
      } else {
        logger.warn(`[WARN] 유효하지 않은 키워드 형식 건너뜀:`, keywordObj);
        continue;
      }
      
      if (typeof keywordText !== 'string' || !keywordText.trim()) {
        logger.warn(`[WARN] 유효하지 않은 키워드 문자열 건너뜀:`, keywordText);
        continue;
      }
      
      logger.info(`[INFO] 키워드 처리 중: ${keywordText}`);
      
      // 키워드 찾기 또는 생성
      const [keywordRecord] = await Keyword.findOrCreate({
        where: { keyword: keywordText },
        defaults: { keyword: keywordText }
      });
      
      logger.info(`[INFO] 저장된 키워드: "${keywordText}" (ID: ${keywordRecord.id})`);
      createdIds.push(keywordRecord.id);

      // [기존 코드 유지: 그룹화된 키워드 처리]
      if (isGrouped && groupKeywords.length > 1) {
        const keywordIds = [keywordRecord.id];
        
        // 첫 번째 이후의 키워드들 처리
        for (let i = 1; i < groupKeywords.length; i++) {
          const groupKeyword = groupKeywords[i];
          const [groupKeywordRecord] = await Keyword.findOrCreate({
            where: { keyword: groupKeyword },
            defaults: { keyword: groupKeyword }
          });
          
          keywordIds.push(groupKeywordRecord.id);
        }
        
        // 그룹화된 키워드 관계 저장을 위해 보관
        groupedKeywords.push({
          keywordIds,
          combinedKeyword: keywordObj.combinedKeyword
        });
      }

      // [기존 코드 유지: UserPlaceKeyword 테이블에 연결 저장]
      if (user_id && place_id) {
        await UserPlaceKeyword.findOrCreate({
          where: { user_id, place_id, keyword_id: keywordRecord.id },
          defaults: { user_id, place_id, keyword_id: keywordRecord.id },
        });
      }
    }

    // [기존 코드 유지: 그룹화된 키워드 관계 저장]
    if (groupedKeywords.length > 0) {
      for (const group of groupedKeywords) {
        // ... 기존 코드 그대로 유지 ...
      }
    }

    logger.info(`[INFO] 저장된 키워드 ID: ${createdIds.join(', ')}`);
    
    // 날짜 기준 크롤링 결정
    const now = new Date();
    const today14h = new Date(now);
    today14h.setHours(14, 0, 0, 0); // 오늘 14:00
    
    // [수정된 부분: Basic 크롤링 수행 여부 결정]
    for (const id of createdIds) {
      try {
        const keywordRecord = await Keyword.findByPk(id);
        if (!keywordRecord) continue;
        
        const keywordName = keywordRecord.keyword;
        let needBasicCrawl = false;
        
        // Basic 크롤링 필요 여부 확인 (14:00 필터링 적용)
        if (!keywordRecord.basic_last_crawled_date) {
          needBasicCrawl = true;
        } else {
          const lastBasicCrawl = new Date(keywordRecord.basic_last_crawled_date);
          // 마지막 크롤링이 오늘 14시 이전이면 다시 크롤링
          if (lastBasicCrawl < today14h && now < today14h) {
            needBasicCrawl = true;
          } else if (lastBasicCrawl.toDateString() !== now.toDateString()) {
            // 다른 날짜라면 크롤링 필요
            needBasicCrawl = true;
          }
        }
        
        // Basic 크롤링 수행
        if (needBasicCrawl) {
          logger.info(`[INFO] 기본 크롤링 시작: 키워드="${keywordName}", ID=${id}`);
          
          // 기본 서울시청 좌표
          const placesData = await crawlKeywordBasic(keywordName, id, 126.9783882, 37.5666103);
          
          // 크롤링 후 날짜 업데이트
          await keywordRecord.update({
            basic_last_crawled_date: new Date()
          });
          
          // 수정: 사용자 선택 키워드 상세 크롤링 작업을 우선순위 높게 큐에 추가
          await addUserSelectedKeywordJob(id);
          logger.info(`[INFO] 사용자 선택 키워드 "${keywordName}" 상세 크롤링 작업을 우선순위로 큐에 추가함`);
          
          // [새로운 코드: 크롤링한 place_id들을 place_detail_results 테이블에 저장]
          if (placesData && placesData.items && placesData.items.length > 0) {
            for (const item of placesData.items) {
              // Place ID 확인
              const placeId = parseInt(item.placeId, 10);
              if (!placeId) continue;
              
              // place_detail_results 테이블에 존재 여부 확인
              const existingPlace = await PlaceDetailResult.findOne({
                where: { place_id: placeId }
              });
              
              if (!existingPlace) {
                // 새 장소 정보 추가
                await PlaceDetailResult.create({
                  place_id: placeId,
                  // 상세 정보는 아직 없음 (detail 크롤링에서 채워짐)
                  blog_review_count: null,
                  receipt_review_count: null,
                  keywordList: null,
                  created_at: new Date()
                });
                logger.info(`[INFO] 새 장소 ID ${placeId}가 place_detail_results에 추가됨`);
              } else {
                // 이미 존재하는 장소는 건너뜀
                logger.debug(`[DEBUG] 장소 ID ${placeId}가 이미 place_detail_results에 존재함`);
              }
            }
            
            // [새로운 코드: 상세 크롤링 작업 예약]
            // 모든 장소의 상세 정보 크롤링을 위한 작업 큐에 추가
            try {
              await detailQueue.add({ 
                needsDetailCrawl: true,
                // keyword_id 대신 전체 크롤링 플래그 사용
                crawlAllPending: true
              });
              logger.info(`[INFO] 상세 크롤링 작업을 큐에 추가함 (키워드 "${keywordName}" 관련)`);
            } catch (queueErr) {
              logger.error(`[ERROR] 상세 크롤링 큐 추가 실패: ${queueErr.message}`);
            }
          }
          
          logger.info(`[INFO] 기본 크롤링 완료: 키워드="${keywordName}", ID=${id}`);
        } else {
          logger.info(`[INFO] 기본 크롤링 건너뜀: 키워드="${keywordName}", ID=${id} - 최근 크롤링됨`);
        }
      } catch (err) {
        logger.error(`[ERROR] 키워드ID=${id} 처리 중 오류 발생:`, err);
        // 오류가 발생해도 계속 다음 키워드 진행
      }
    }

    return res.json({ 
      success: true, 
      message: `${createdIds.length}개 키워드가 저장되었습니다.` 
    });
  } catch (err) {
    logger.error('[ERROR] saveSelectedKeywordsHandler:', err);
    return res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
}