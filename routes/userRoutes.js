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
 * GET /api/keyword-ranking-details?userId=xxx&placeId=yyy&keyword=zzz
 * - 3개월 전부터 현재까지의 데이터를 조회
 * - place_id + (14시 기준) 날짜로 Basic/Detail 데이터를 묶어 반환
 */
router.get("/keyword-ranking-details", authenticateJWT, async (req, res) => {
  try {
    const { userId, placeId, keyword } = req.query;

    // (1) user_place_keywords에서 (user_id, place_id)에 해당하는 row 조회
    const upk = await UserPlaceKeyword.findOne({
      where: { user_id: userId, place_id: placeId }
    });
    if (!upk) {
      // 해당 유저-업체 매핑이 없으면 빈 배열 반환
      return res.json([]);
    }

    // (2) keywords 테이블에서 keyword 문자열로 검색
    const kw = await Keyword.findOne({
      where: { keyword }
    });
    if (!kw) {
      // 요청 keyword가 없으면 빈 배열
      return res.json([]);
    }

    // (2-1) user_place_keywords에 있는 keyword_id와 실제 Keyword id가 일치하는지 확인
    // 필요 없다면 이 조건을 제거할 수 있습니다.
    if (upk.keyword_id !== kw.id) {
      // 매핑이 불일치하면 빈 배열
      return res.json([]);
    }

    // (3) 3개월 전부터 현재까지 범위 계산
    const threeMonthsAgo = dayjs().subtract(3, "month").startOf("day").toDate();
    const now = new Date();

    // (4) Basic Crawl 결과 조회 (keyword_id 동일 + updated_at이 3개월 이내)
    const basicResults = await KeywordBasicCrawlResult.findAll({
      where: {
        keyword_id: kw.id,
        last_crawled_at: {
          [Op.between]: [threeMonthsAgo, now],
        },
      },
      order: [["updated_at", "ASC"]],
    });

    // (4-1) Basic 결과에서 place_id 목록 추출
    const placeIds = [...new Set(basicResults.map((row) => row.place_id))];

    // (5) place_detail_results에서 place_id가 위 목록에 속하고,
    //     last_crawled_at이 3개월 이내인 데이터만 조회
    const detailResults = await PlaceDetailResult.findAll({
      where: {
        place_id: placeIds,
        last_crawled_at: {
          [Op.between]: [threeMonthsAgo, now],
        },
      },
      order: [["last_crawled_at", "ASC"]],
    });

    // (6) Basic 결과를 "place_id + (14시 기준) 날짜"로 매핑
    const basicMap = {};
    for (const b of basicResults) {
      const pid = b.place_id;
      const dateKey = getCrawlDate(b.updated_at);
      if (!basicMap[pid]) {
        basicMap[pid] = {};
      }
      if (!basicMap[pid][dateKey]) {
        basicMap[pid][dateKey] = [];
      }
      basicMap[pid][dateKey].push(b);
    }

    // Detail 결과도 동일하게 매핑
    const detailMap = {};
    for (const d of detailResults) {
      const pid = d.place_id;
      const dateKey = getCrawlDate(d.last_crawled_at);
      if (!detailMap[pid]) {
        detailMap[pid] = {};
      }
      if (!detailMap[pid][dateKey]) {
        detailMap[pid][dateKey] = [];
      }
      detailMap[pid][dateKey].push(d);
    }

    // (7) 최종 합치기
    // 날짜별로 basic / detail 각각 1개만 존재한다고 가정
    // 여러 건이 있을 경우, 필요에 따라 처리 로직을 바꾸세요
    const finalData = [];
    for (const pid of placeIds) {
      const basicDateKeys = basicMap[pid] ? Object.keys(basicMap[pid]) : [];
      const detailDateKeys = detailMap[pid] ? Object.keys(detailMap[pid]) : [];
      const allDateKeys = new Set([...basicDateKeys, ...detailDateKeys]);

      for (const dateKey of allDateKeys) {
        const basicRows = basicMap[pid]?.[dateKey] || [];
        const detailRows = detailMap[pid]?.[dateKey] || [];

        // 여기서는 예시로 "각 날짜에 대해 basic 1건 + detail 1건"만 응답
        const b = basicRows[0] || null;
        const d = detailRows[0] || null;

        finalData.push({
          ranking: b ? b.ranking : null,
          place_id: pid,
          place_name: b ? b.place_name : null,
          category: b ? b.category : null,
          savedCount: b ? b.savedCount : null,
          
          blog_review_count: d ? d.blog_review_count : null,
          receipt_review_count: d ? d.receipt_review_count : null,
          
          // keywordList가 JSON 문자열인지 "키워드1,키워드2" 형태인지에 따라 처리
          keywordList: d?.keywordList
            ? ( // 만약 JSON 형태라면 JSON.parse, 아니면 split
              typeof d.keywordList === "string" && d.keywordList.trim().startsWith("[")
                ? JSON.parse(d.keywordList)
                : d.keywordList.split(",")
            )
            : null,

          // 확인용으로 날짜 키를 함께 전달 (프론트에서 필요 없다면 제거)
          date_key: dateKey,
        });
      }
    }

    return res.json(finalData);
  } catch (err) {
    logger.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;