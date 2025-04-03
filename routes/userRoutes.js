// routes/userRoutes.js
import express from "express";
import passport from "passport";
import dayjs from "dayjs"
// User 모델 import (경로는 프로젝트 구조에 맞춰 수정)
import  User  from "../models/User.js"; 
import Place  from "../models/Place.js";
import Keyword  from "../models/Keyword.js";
import KeywordCrawlResult  from "../models/KeywordBasicCrawlResult.js";
import UserPlaceKeyword  from "../models/UserPlaceKeyword.js";
import PlaceDetailResult from "../models/PlaceDetailResult.js";
import KeywordBasicCrawlResult from "../models/KeywordBasicCrawlResult.js";
import { Op } from "sequelize"; // Add this import for Op.between
import { createLogger } from "../lib/logger.js";
const logger = createLogger("UserRoutesLogger");
const router = express.Router();
const authenticateJWT = passport.authenticate('jwt', { session: false });

/**
 * (1) GET /api/users/me
 *  - JWT 토큰 인증(Passport) 후, 해당 유저의 정보 반환
 */
router.get(
  "/user/me",
  // JWT Strategy 사용
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    try {
      // passport-jwt 성공 시 req.user에 DB에서 찾은 user 객체가 들어있음
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const fullUser = await User.findOne({
        where: { id: req.user.id },
        // <<< 여기서 include로 places 테이블 정보도 함께 조회
        include: [
          {
            model: Place,
            as: "places", // 위에서 설정한 hasMany의 'as'
          },
        ],
      })
      if (!fullUser) {
        return res.status(404).json({ message: "User not found" })
      }

      // 예: fullUser의 기본 필드 + fullUser.places
      return res.json({
        id: fullUser.id,
        name: fullUser.name,
        email: fullUser.email,
        avatar_url: fullUser.avatar_url,
        role: fullUser.role,
        // ...
        places: fullUser.places.map((p) => ({
          place_name: p.place_name,
          platform: p.platform,
          // ...
        })),
      })
    } catch (err) {
      logger.error("[ERROR] GET /api/user/me:", err);
      return res.status(500).json({ message: "Server Error" });
    }
  }
);

/**
 * (2) PATCH /api/users/complete-registration
 *  - url_registration 컬럼을 1로 업데이트해주는 예시
 */
router.patch(
  "/user/complete-registration",
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    try {
      // passport-jwt 인증 성공 시 req.user에서 user 정보를 가져올 수 있음
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // models/User.js에서 만든 updateUrlRegistration 메서드 사용
      await User.updateUrlRegistration(req.user.id);

      // 성공 응답
      return res.json({
        success: true,
        message: "Registration completed (url_registration = 1)."
      });
    } catch (err) {
      logger.error("[ERROR] PATCH /api/users/complete-registration:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);


/**
 * GET /api/keyword-results - 키워드 결과 조회
 * placeId와 keywordId로 검색하여 결과 반환
 */
router.get("/keyword-results", authenticateJWT, async (req, res) => {
  try {
    const { placeId, keywordId, category, recordId, historical, fromDate, toDate } = req.query;
    
    if (!placeId || !keywordId) {
      return res.status(400).json({ message: "placeId and keywordId are required" });
    }

    // 기본 조회 조건
    const where = {
      keyword_id: keywordId,
      place_id: placeId
    };

    // 선택적 필터 조건 추가
    if (category) {
      where.category = category;
    }

    if (recordId) {
      where.id = recordId;
    }

    // 날짜 범위 필터 (historical이 true인 경우)
    if (historical === 'true' && fromDate && toDate) {
      where.created_at = {
        [Op.between]: [new Date(fromDate), new Date(toDate)]
      };
    }

    // 최신 데이터부터 정렬
    const results = await KeywordCrawlResult.findAll({
      where,
      order: [['created_at', 'DESC']]
    });

    return res.json(results);
  } catch (err) {
    logger.error("[ERROR] GET /api/keyword-results:", err);
    return res.status(500).json({ message: "Server Error" });
  }
});

/**
 * GET /api/user-keywords - 사용자별 업체 키워드 목록 조회
 * userId와 placeId로 조회
 */
router.get("/user-keywords", authenticateJWT, async (req, res) => {
  try {
    const { userId, placeId } = req.query;
    
    if (!userId || !placeId) {
      return res.status(400).json({ message: "userId and placeId are required" });
    }

    // 요청한 유저와 인증된 유저가 일치하는지 확인 (보안)
    if (String(req.user.id) !== String(userId)) {
      return res.status(403).json({ message: "Forbidden: Cannot access other user's keywords" });
    }

    // 유저-업체별 키워드 조회 - 연관 관계가 없으므로 별도 쿼리로 처리
    const userKeywords = await UserPlaceKeyword.findAll({
      where: {
        user_id: userId,
        place_id: placeId
      }
    });

    // 키워드 ID 목록 추출
    const keywordIds = userKeywords.map(uk => uk.keyword_id);
    
    // 키워드 목록 별도 조회
    const keywords = await Keyword.findAll({
      where: {
        id: {
          [Op.in]: keywordIds
        }
      },
      // 필요하다면 확인하려는 칼럼들 명시 (예: ["id", "name"] )
      attributes: ["id", "keyword"]
    });

    // 키워드 ID를 키로 하는 맵 생성
    const keywordMap = {};
    keywords.forEach(k => {
      keywordMap[k.id] = k;
    });

    logger.debug("[user-keywords] userKeywords:", userKeywords);
    logger.debug("[user-keywords] keywordIds:", keywordIds);

    // 응답 형식 가공
    const formattedKeywords = userKeywords.map(uk => ({
      id: uk.id,
      user_id: uk.user_id,
      place_id: uk.place_id,
      keyword_id: uk.keyword_id,
      keyword: keywordMap[uk.keyword_id]?.keyword,
      created_at: uk.created_at,
      updated_at: uk.updated_at
    }));

    logger.debug("[user-keywords] formattedKeywords:", formattedKeywords);

    return res.json(formattedKeywords);
  } catch (err) {
    logger.error("[ERROR] GET /api/user-keywords:", err);
    return res.status(500).json({ message: "Server Error" });
  }
});

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
router.get("/keyword-ranking-details", authenticateJWT, async (req, res) => {
  try {
    const { userId, placeId } = req.query;

    if (!userId || !placeId) {
      return res.status(400).json({ 
        success: false, 
        message: "userId와 placeId는 필수 파라미터입니다." 
      });
    }

    // (1) UserPlaceKeyword에서 해당 사용자-업체에 연결된 모든 키워드 ID 조회
    const userPlaceKeywords = await UserPlaceKeyword.findAll({
      where: { user_id: userId, place_id: placeId }
    });

    if (userPlaceKeywords.length === 0) {
      logger.info(`[keyword-ranking-details] 키워드 없음: userId=${userId}, placeId=${placeId}`);
      return res.json({ success: true, data: [] });
    }

    // 키워드 ID 목록 추출
    const keywordIds = userPlaceKeywords.map(upk => upk.keyword_id);
    
    // (2) 키워드 정보 조회
    const keywords = await Keyword.findAll({
      where: { id: { [Op.in]: keywordIds } }
    });
    
    // 키워드 ID -> 키워드 문자열 매핑 생성
    const keywordMap = {};
    keywords.forEach(k => {
      keywordMap[k.id] = k.keyword;
    });

    logger.debug(`[DEBUG] 총 ${keywordIds.length}개 키워드 ID 조회: ${keywordIds.join(', ')}`);
    logger.debug(`[DEBUG] 키워드 매핑: ${JSON.stringify(keywordMap)}`);

    // (3) 3개월 전부터 현재까지 범위 계산
    const threeMonthsAgo = dayjs().subtract(3, "month").startOf("day").toDate();
    const now = new Date();

    // (4) 모든 키워드 ID에 대한 BasicCrawlResult 조회
    const basicResults = await KeywordBasicCrawlResult.findAll({
      where: {
        keyword_id: { [Op.in]: keywordIds },
        ranking: { [Op.not]: null },
        last_crawled_at: {
          [Op.between]: [threeMonthsAgo, now]
        }
      },
      order: [["last_crawled_at", "DESC"], ["updated_at", "DESC"]]
    });

    logger.debug(`[DEBUG] 총 ${keywords.length}개 키워드에 대한 ${basicResults.length}개 데이터 조회됨`);

    // (5) BasicResults에서 place_id 목록 추출
    const placeIds = [...new Set(basicResults.map(b => b.place_id))];

    // 날짜별/키워드별로 가장 최신 데이터를 매핑
    // 구조: { 날짜: { 키워드ID: { 장소ID: 데이터 } } }
    const basicDateMap = {};
    
    for (const b of basicResults) {
      const dateKey = getCrawlDate(b.last_crawled_at || b.updated_at);
      if (!dateKey) continue;

      if (!basicDateMap[dateKey]) {
        basicDateMap[dateKey] = {};
      }
      
      if (!basicDateMap[dateKey][b.keyword_id]) {
        basicDateMap[dateKey][b.keyword_id] = {};
      }

      // 같은 날짜/키워드/장소에 대해 가장 최신 데이터만 유지
      if (!basicDateMap[dateKey][b.keyword_id][b.place_id] || 
          new Date(b.last_crawled_at) > new Date(basicDateMap[dateKey][b.keyword_id][b.place_id].last_crawled_at)) {
        basicDateMap[dateKey][b.keyword_id][b.place_id] = b;
      }
    }

    // (6) PlaceDetailResult 조회 추가
    const detailResults = await PlaceDetailResult.findAll({
      where: {
        place_id: { [Op.in]: placeIds },
        last_crawled_at: { [Op.between]: [threeMonthsAgo, now] }
      },
      order: [["last_crawled_at", "DESC"]]
    });

    logger.debug(`[DEBUG] Detail 데이터 ${detailResults.length}개 조회됨`);

    // 날짜별로 가장 최신 데이터를 매핑
    const detailMap = {};
    for (const d of detailResults) {
      const pid = d.place_id;
      if (!detailMap[pid]) detailMap[pid] = {};

      const dateKey = getCrawlDate(d.last_crawled_at);
      if (!dateKey) continue;

      // 같은 날짜/장소에 대해 가장 최신 데이터만 유지
      if (!detailMap[pid][dateKey] || 
          new Date(d.last_crawled_at) > new Date(detailMap[pid][dateKey].last_crawled_at)) {
        detailMap[pid][dateKey] = d;
      }
    }

    // (7) 각 날짜별, 키워드별로 데이터 정리
    const finalData = [];
    const uniqueDateKeys = [...new Set(Object.keys(basicDateMap))];

    // 날짜별 처리
    for (const dateKey of uniqueDateKeys) {
      // 해당 날짜의 모든 키워드 데이터 처리
      const keywordsForDate = basicDateMap[dateKey];
      
      for (const keywordId in keywordsForDate) {
        const placesForKeyword = keywordsForDate[keywordId];
        const keywordString = keywordMap[keywordId] || `키워드ID:${keywordId}`;
        
        for (const pid in placesForKeyword) {
          const b = placesForKeyword[pid];

          // 같은 날짜의 detail 데이터 찾기
          let d = detailMap[pid]?.[dateKey];

          // 같은 날짜의 detail이 없으면 가장 가까운 이전 날짜의 detail 찾기
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
            savedCount: d ? d.savedCount : null,
            blog_review_count: d ? d.blog_review_count : null,
            receipt_review_count: d ? d.receipt_review_count : null,
            keywordList: d?.keywordList
              ? (typeof d.keywordList === "string" && d.keywordList.trim().startsWith("[")
                  ? JSON.parse(d.keywordList)
                  : d.keywordList.split(","))
              : null,
            date_key: dateKey,
          });
        }
      }
    }

    // 결과 정렬 - 날짜별로 먼저 정렬하고, 같은 날짜 내에서는 키워드별, 순위로 정렬
    finalData.sort((a, b) => {
      if (a.date_key !== b.date_key) {
        return a.date_key.localeCompare(b.date_key);
      }
      if (a.keyword !== b.keyword) {
        return a.keyword.localeCompare(b.keyword);
      }
      return (a.ranking || 999) - (b.ranking || 999);
    });

    // 로깅
    logger.debug(`[keyword-ranking-details] 총 ${finalData.length}개 결과 반환: userId=${userId}, placeId=${placeId}, 키워드 ${keywordIds.length}개`);

    return res.json({
      success: true,
      data: finalData
    });
  } catch (err) {
    logger.error(`[keyword-ranking-details] 오류 발생:`, err);
    return res.status(500).json({ 
      success: false,
      message: "서버 오류가 발생했습니다." 
    });
  }
});

export default router;