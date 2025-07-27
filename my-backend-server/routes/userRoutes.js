// routes/userRoutes.js
import express from "express";
import dayjs from "dayjs";
import { Op } from "sequelize";

// Models
import User from "../models/User.js";
import Place from "../models/Place.js";
import Keyword from "../models/Keyword.js";
import UserPlaceKeyword from "../models/UserPlaceKeyword.js";
import PlaceDetailResult from "../models/PlaceDetailResult.js";
import KeywordBasicCrawlResult from "../models/KeywordBasicCrawlResult.js";
import WorkHistory from "../models/WorkHistory.js";

// Utils & Middleware
import { createLogger } from "../lib/logger.js";
import { authenticateJWT, asyncHandler } from "../middlewares/auth.js";
import { sendSuccess, sendError } from "../lib/response.js";

const logger = createLogger("UserRoutesLogger");
const router = express.Router();

/**
 * (1) GET /api/users/me
 *  - JWT 토큰 인증(Passport) 후, 해당 유저의 정보 반환
 */
router.get(
  "/user/me",
  authenticateJWT,
  asyncHandler(async (req, res) => {
    // passport-jwt 성공 시 req.user에 DB에서 찾은 user 객체가 들어있음
    if (!req.user) {
      // authenticateJWT 미들웨어에서 이미 처리되었어야 하지만, 방어적으로 코딩
      return sendError(res, 401, "Unauthorized");
    }
    const fullUser = await User.findOne({
      where: { id: req.user.id },
      include: [
        {
          model: Place,
          as: "places",
        },
      ],
    });
    if (!fullUser) {
      return sendError(res, 404, "User not found");
    }

    const userData = {
      id: fullUser.id,
      name: fullUser.name,
      email: fullUser.email,
      avatar_url: fullUser.avatar_url,
      role: fullUser.role,
      places: fullUser.places.map((p) => ({
        place_name: p.place_name,
        platform: p.platform,
        // ... 필요한 다른 place 필드들
      })),
    };
    return sendSuccess(res, userData);
  })
);

/**
 * (2) PATCH /api/users/complete-registration
 *  - url_registration 컬럼을 1로 업데이트해주는 예시
 */
router.patch(
  "/user/complete-registration",
  authenticateJWT,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      return sendError(res, 401, "Unauthorized");
    }
    await User.updateUrlRegistration(req.user.id);
    return sendSuccess(res, null, "Registration completed (url_registration = 1).");
  })
);


/**
 * GET /api/keyword-results - 키워드 결과 조회
 * placeId와 keywordId로 검색하여 결과 반환
 */
router.get("/keyword-results", authenticateJWT, asyncHandler(async (req, res) => {
  const { placeId, keywordId, category, recordId, historical, fromDate, toDate } = req.query;
  
  if (!placeId || !keywordId) {
    return sendError(res, 400, "placeId and keywordId are required");
  }

  const where = {
    keyword_id: keywordId,
    place_id: placeId
  };

  if (category) {
    where.category = category;
  }
  if (recordId) {
    where.id = recordId;
  }
  if (historical === 'true' && fromDate && toDate) {
    where.created_at = {
      [Op.between]: [new Date(fromDate), new Date(toDate)]
    };
  }

  const results = await KeywordBasicCrawlResult.findAll({
    where,
    order: [['created_at', 'DESC']]
  });

  return sendSuccess(res, results);
}));

/**
 * GET /api/user-keywords - 사용자별 업체 키워드 목록 조회
 * userId와 placeId로 조회
 */
router.get("/user-keywords", authenticateJWT, asyncHandler(async (req, res) => {
  const { userId, placeId } = req.query;
  
  if (!userId || !placeId) {
    return sendError(res, 400, "userId and placeId are required");
  }

  if (String(req.user.id) !== String(userId)) {
    return sendError(res, 403, "Forbidden: Cannot access other user's keywords");
  }

  const userKeywords = await UserPlaceKeyword.findAll({
    where: {
      user_id: userId,
      place_id: placeId
    }
  });

  const keywordIds = userKeywords.map(uk => uk.keyword_id);
  
  const keywords = await Keyword.findAll({
    where: {
      id: { [Op.in]: keywordIds }
    },
    attributes: ["id", "keyword"]
  });

  const keywordMap = {};
  keywords.forEach(k => {
    keywordMap[k.id] = k;
  });

  const formattedKeywords = userKeywords.map(uk => ({
    id: uk.id,
    user_id: uk.user_id,
    place_id: uk.place_id,
    keyword_id: uk.keyword_id,
    keyword: keywordMap[uk.keyword_id]?.keyword,
    created_at: uk.created_at,
    updated_at: uk.updated_at
  }));

  return sendSuccess(res, formattedKeywords);
}));

// 14시(2PM) 기준으로 "하루"를 판별하는 함수
// 예: 3/13 10:00 → 3/12, 3/13 15:00 → 3/13
function getCrawlDate(dateTime) {
  if (!dateTime) return null;

  const d = dayjs(dateTime);
  const hour = d.hour();
  
  // 14시 이전이면 하루 전 날짜로 처리
  if (hour < 14) {
    return d.subtract(1, 'day').format('YYYY-MM-DD');
  } else {
    return d.format('YYYY-MM-DD');
  }
}

/**
 * GET /api/keyword-ranking-details?userId=xxx&placeId=yyy
 * - 사용자와 업체에 연결된 모든 키워드의 3개월 데이터를 조회
 * - place_id + (14시 기준) 날짜로 Basic/Detail 데이터를 묶어 반환
 */
router.get("/keyword-ranking-details", authenticateJWT, asyncHandler(async (req, res) => {
  const { userId, placeId, keyword: keywordQuery } = req.query; // req.query.keyword를 keywordQuery로 변경 (Keyword 모델과 혼동 방지)

  if (!userId || !placeId) {
    return sendError(res, 400, "userId와 placeId는 필수 파라미터입니다.");
  }
  
  logger.info(`[keyword-ranking-details] 요청 시작: userId=${userId}, placeId=${placeId}, keyword=${keywordQuery || '전체'}`);

  const userPlaceKeywords = await UserPlaceKeyword.findAll({
    where: { user_id: userId, place_id: placeId }
  });

  if (userPlaceKeywords.length === 0) {
    logger.info(`[keyword-ranking-details] 키워드 없음: userId=${userId}, placeId=${placeId}`);
    return sendSuccess(res, []); // 데이터가 없는 성공 케이스
  }

  const keywordIds = userPlaceKeywords.map(upk => upk.keyword_id);
  
  const keywordsData = await Keyword.findAll({ // 변수명 변경 keywords -> keywordsData
    where: { id: { [Op.in]: keywordIds } }
  });
  
  const keywordMap = {};
  const isRestaurantMap = {};
  keywordsData.forEach(k => {
    keywordMap[k.id] = k.keyword;
    isRestaurantMap[k.id] = k.isRestaurant || false;
  });

  let filteredKeywordIds = keywordIds;
  if (keywordQuery) {
    filteredKeywordIds = keywordsData
      .filter(k => k.keyword.includes(keywordQuery))
      .map(k => k.id);
    
    if (filteredKeywordIds.length === 0) {
      logger.info(`[keyword-ranking-details] 일치하는 키워드 없음: keyword=${keywordQuery}`);
      return sendSuccess(res, []); // 데이터가 없는 성공 케이스
    }
    logger.info(`[keyword-ranking-details] 키워드 필터링: \"${keywordQuery}\" 검색어로 ${filteredKeywordIds.length}개 키워드 매칭됨`);
  }

  logger.info(`[keyword-ranking-details] 조회할 키워드 목록 (총 ${filteredKeywordIds.length}개):`);
  keywordsData
    .filter(k => filteredKeywordIds.includes(k.id))
    .forEach(k => {
      logger.info(`- 키워드: \"${k.keyword}\" (ID: ${k.id})`);
    });

  const threeMonthsAgo = dayjs().subtract(3, "month").startOf("day").toDate();
  const now = new Date();

  const basicResults = await KeywordBasicCrawlResult.findAll({
    where: {
      keyword_id: { [Op.in]: filteredKeywordIds },
      ranking: { [Op.not]: null },
      last_crawled_at: {
        [Op.between]: [threeMonthsAgo, now]
      }
    },
    order: [["last_crawled_at", "DESC"], ["updated_at", "DESC"]]
  });

  const keywordDataCounts = {};
  keywordIds.forEach(id => { keywordDataCounts[id] = 0; });
  basicResults.forEach(result => {
    if (keywordDataCounts[result.keyword_id] !== undefined) {
      keywordDataCounts[result.keyword_id]++;
    }
  });

  logger.debug(`[DEBUG] 총 ${keywordsData.length}개 키워드에 대한 ${basicResults.length}개 데이터 조회됨`);

  const placeIds = [...new Set(basicResults.map(b => b.place_id))];
  const basicDateMap = {};
  
  for (const b of basicResults) {
    const dateKey = getCrawlDate(b.last_crawled_at || b.updated_at);
    if (!dateKey) continue;
    if (!basicDateMap[dateKey]) basicDateMap[dateKey] = {};
    if (!basicDateMap[dateKey][b.keyword_id]) basicDateMap[dateKey][b.keyword_id] = {};
    if (!basicDateMap[dateKey][b.keyword_id][b.place_id] || 
        new Date(b.last_crawled_at) > new Date(basicDateMap[dateKey][b.keyword_id][b.place_id].last_crawled_at)) {
      basicDateMap[dateKey][b.keyword_id][b.place_id] = b;
    }
  }

  const keywordFinalCounts = {};
  keywordIds.forEach(id => { keywordFinalCounts[id] = 0; });

  const detailResults = await PlaceDetailResult.findAll({
    where: {
      place_id: { [Op.in]: placeIds },
      last_crawled_at: { [Op.between]: [threeMonthsAgo, now] }
    },
    order: [["last_crawled_at", "DESC"]]
  });

  const detailMap = {};
  for (const d of detailResults) {
    const pid = d.place_id;
    if (!detailMap[pid]) detailMap[pid] = {};
    const dateKey = getCrawlDate(d.last_crawled_at);
    if (!dateKey) continue;
    if (!detailMap[pid][dateKey] || 
        new Date(d.last_crawled_at) > new Date(detailMap[pid][dateKey].last_crawled_at)) {
      detailMap[pid][dateKey] = d;
    }
  }

  const finalData = [];
  const uniqueDateKeys = [...new Set(Object.keys(basicDateMap))];

  for (const dateKey of uniqueDateKeys) {
    const keywordsForDate = basicDateMap[dateKey];
    for (const keywordId in keywordsForDate) {
      const placesForKeyword = keywordsForDate[keywordId];
      const keywordString = keywordMap[keywordId] || `키워드ID:${keywordId}`;
      for (const pid in placesForKeyword) {
        const b = placesForKeyword[pid];
        let d = detailMap[pid]?.[dateKey];
        if (!d) {
          const allDetailDates = detailMap[pid] ? Object.keys(detailMap[pid]).sort().reverse() : [];
          for (const detailDateKey of allDetailDates) {
            if (detailDateKey <= dateKey) {
              d = detailMap[pid][detailDateKey];
              break;
            }
          }
        }
        finalData.push({
          id: `${keywordId}_${pid}_${dateKey}`,
          keyword_id: parseInt(keywordId),
          keyword: keywordString,
          ranking: b.ranking,
          place_id: parseInt(pid),
          place_name: b.place_name,
          category: b.category,
          isRestaurant: isRestaurantMap[keywordId] || false,
          savedCount: d?.savedCount ?? null,
          blog_review_count: d ? d.blog_review_count : null,
          receipt_review_count: d ? d.receipt_review_count : null,
          keywordList: d?.keywordList
            ? (typeof d.keywordList === "string" && d.keywordList.trim().startsWith("[")
                ? JSON.parse(d.keywordList)
                : d.keywordList.split(","))
            : null,
          date_key: dateKey,
          crawled_at: b.last_crawled_at ? new Date(b.last_crawled_at).toISOString() : new Date().toISOString(),
        });
        if (keywordFinalCounts[keywordId] !== undefined) {
          keywordFinalCounts[keywordId]++;
        }
      }
    }
  }

  finalData.sort((a, b) => {
    if (a.date_key !== b.date_key) return a.date_key.localeCompare(b.date_key);
    if (a.keyword !== b.keyword) return a.keyword.localeCompare(b.keyword);
    return (a.ranking || 999) - (b.ranking || 999);
  });

  logger.info(`[keyword-ranking-details] 총 ${finalData.length}개 결과 반환: userId=${userId}, placeId=${placeId}, 키워드 ${keywordIds.length}개`);
  
  return sendSuccess(res, {
    data: finalData,
    metadata: {
      totalItems: finalData.length,
      keywordCounts: keywordFinalCounts
    }
  });
}));

/**
 * GET /api/main-keyword-chart-data?userId=xxx&placeId=yyy
 * 메인 키워드의 2주간 순위 변화 데이터 조회
 */
router.get("/main-keyword-chart-data", authenticateJWT, asyncHandler(async (req, res) => {
  const { userId, placeId } = req.query;

  if (!userId || !placeId) {
    return sendError(res, 400, "userId와 placeId는 필수 파라미터입니다.");
  }
  
  logger.info(`[main-keyword-chart-data] 요청 시작: userId=${userId}, placeId=${placeId}`);

  try {
    // 1. 메인 키워드 조회
    const mainKeywordRelation = await UserPlaceKeyword.findOne({
      where: { user_id: userId, place_id: placeId, isMain: true }
    });

    if (!mainKeywordRelation) {
      logger.info(`[main-keyword-chart-data] 메인 키워드 없음: userId=${userId}, placeId=${placeId}`);
      return sendSuccess(res, []);
    }

    const keywordId = mainKeywordRelation.keyword_id;

    // 2. 키워드 정보 조회
    const keyword = await Keyword.findByPk(keywordId);
    if (!keyword) {
      logger.info(`[main-keyword-chart-data] 키워드 정보 없음: keywordId=${keywordId}`);
      return sendSuccess(res, []);
    }

    // 3. 2주간 크롤링 데이터 조회
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const rankingData = await KeywordBasicCrawlResult.findAll({
      where: {
        keyword_id: keywordId,
        place_id: placeId,
        ranking: { [Op.not]: null },
        last_crawled_at: {
          [Op.gte]: twoWeeksAgo
        }
      },
      order: [["last_crawled_at", "ASC"]],
      raw: true
    });

    // 4. 날짜별 데이터 그룹화 (하루에 여러 번 크롤링된 경우 최신 데이터만 사용)
    const dateGroupedData = {};
    rankingData.forEach(item => {
      const dateKey = getCrawlDate(item.last_crawled_at);
      if (dateKey && (!dateGroupedData[dateKey] || 
          new Date(item.last_crawled_at) > new Date(dateGroupedData[dateKey].last_crawled_at))) {
        dateGroupedData[dateKey] = item;
      }
    });

    // 5. 결과 데이터 구성
    const chartData = Object.values(dateGroupedData)
      .map(item => ({
        date: getCrawlDate(item.last_crawled_at),
        ranking: item.ranking,
        keyword: keyword.keyword,
        place_id: parseInt(placeId),
        place_name: item.place_name,
        crawled_at: item.last_crawled_at
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    logger.info(`[main-keyword-chart-data] 총 ${chartData.length}개 데이터 반환: userId=${userId}, placeId=${placeId}, keyword=${keyword.keyword}`);
    
    return sendSuccess(res, chartData);

  } catch (error) {
    logger.error('[main-keyword-chart-data] 오류:', error);
    return sendError(res, 500, '차트 데이터 조회 중 오류가 발생했습니다.');
  }
}));

/**
 * GET /api/user/work-histories
 * 현재 로그인한 사용자의 작업 이력 조회 API
 */
router.get('/user/work-histories', authenticateJWT, asyncHandler(async (req, res) => {
  if (!req.user || !req.user.id) {
    logger.warn('인증되지 않은 사용자가 작업 이력을 요청함');
    // authenticateJWT에서 이미 처리되었을 가능성이 높지만, 명시적으로 한 번 더 확인
    return sendError(res, 401, "로그인이 필요합니다.");
  }

  const userId = req.user.id;
  logger.info(`사용자(ID: ${userId})의 작업 이력 조회 요청`);

  const workHistories = await WorkHistory.findAll({
    where: { user_id: userId },
    order: [["created_at", "DESC"]]
  });

  logger.info(`사용자(ID: ${userId})의 작업 이력 ${workHistories.length}개 조회됨`);
  return sendSuccess(res, workHistories);
}));

export default router;