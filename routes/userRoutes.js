// routes/userRoutes.js
import express from "express";
import passport from "passport";

// User 모델 import (경로는 프로젝트 구조에 맞춰 수정)
import  User  from "../models/User.js"; 
import Place  from "../models/Place.js";
const router = express.Router();

/**
 * (1) GET /api/users/me
 *  - JWT 토큰 인증(Passport) 후, 해당 유저의 정보 반환
 */
router.get(
  "/me",
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
  "/complete-registration",
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

router.get(
  '/profile',
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      // passport-jwt로 인증이 통과되면 req.user에 사용자 정보가 들어 있다고 가정.
      // DB에서 추가 정보를 가져오고 싶으면, 예: User 모델에서 findByPk로 불러오기
      // const userData = await User.findByPk(req.user.id)
      // 여기서는 단순히 req.user를 직접 반환한다고 가정

      const user = req.user
      res.json({
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      })
    } catch (error) {
      console.error(error)
      res.status(500).json({ message: '서버 에러' })
    }
  }
)

export default router;