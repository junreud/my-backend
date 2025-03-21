// routes/userRoutes.js
import express from "express";
import passport from "passport";

// User 모델 import (경로는 프로젝트 구조에 맞춰 수정)
import  User  from "../models/User.js"; 
import Place  from "../models/Place.js";
import Keyword  from "../models/Keyword.js";
import KeywordCrawlResult  from "../models/KeywordCrawlResult.js";
import UserPlaceKeyword  from "../models/UserPlaceKeyword.js";
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
      console.error("[ERROR] GET /api/user/me:", err);
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
      console.error("[ERROR] PATCH /api/users/complete-registration:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);


/**
 * GET /api/keywords - 키워드 조회
 * 키워드 이름으로 검색
 */
router.get("/", passport.authenticate, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ message: "Keyword name is required" });
    }

    const keyword = await Keyword.findOne({ 
      where: { name }
    });

    if (!keyword) {
      return res.status(404).json({ message: "Keyword not found" });
    }

    return res.json(keyword);
  } catch (err) {
    console.error("[ERROR] GET /api/keywords:", err);
    return res.status(500).json({ message: "Server Error" });
  }
});

/**
 * GET /api/keyword-results - 키워드 결과 조회
 * placeId와 keywordId로 검색하여 결과 반환
 */
router.get("/keyword-results", passport.authenticate, async (req, res) => {
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
    console.error("[ERROR] GET /api/keyword-results:", err);
    return res.status(500).json({ message: "Server Error" });
  }
});

/**
 * GET /api/user-keywords - 사용자별 업체 키워드 목록 조회
 * userId와 placeId로 조회
 */
router.get("/user-keywords", passport.authenticate, async (req, res) => {
  try {
    const { userId, placeId } = req.query;
    
    if (!userId || !placeId) {
      return res.status(400).json({ message: "userId and placeId are required" });
    }

    // 요청한 유저와 인증된 유저가 일치하는지 확인 (보안)
    if (String(req.user.id) !== String(userId)) {
      return res.status(403).json({ message: "Forbidden: Cannot access other user's keywords" });
    }

    // 유저-업체별 키워드 조회
    const userKeywords = await UserPlaceKeyword.findAll({
      where: {
        user_id: userId,
        place_id: placeId
      },
      include: [
        {
          model: Keyword,
          attributes: ['id', 'name']
        }
      ]
    });

    // 응답 형식 가공
    const formattedKeywords = userKeywords.map(uk => ({
      id: uk.id,
      user_id: uk.user_id,
      place_id: uk.place_id,
      keyword_id: uk.keyword_id,
      name: uk.keyword.name,
      created_at: uk.created_at,
      updated_at: uk.updated_at
    }));

    return res.json(formattedKeywords);
  } catch (err) {
    console.error("[ERROR] GET /api/user-keywords:", err);
    return res.status(500).json({ message: "Server Error" });
  }
});

export default router;

