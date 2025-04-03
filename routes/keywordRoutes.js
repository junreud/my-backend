import express from "express"
import passport from "passport"
import {
  normalizeUrlHandler,
  storePlaceHandler,
  chatgptKeywordsHandler,
  combineLocationAndFeaturesHandler,
  searchVolumesHandler,
  groupKeywordsHandler,
  saveGroupedKeywordsHandler,
  saveSelectedKeywordsHandler,
  addUserKeywordHandler,
  changeUserKeywordHandler,
  getKeywordStatusHandler, // 추가: 키워드 상태 확인 핸들러
} from "../controllers/keywordController.js"

const router = express.Router()

// 라우터 레벨 미들웨어로 모든 요청에 대해 로그 추가
router.use((req, res, next) => {
  console.log(`[ROUTER DEBUG] 키워드 라우터 요청: ${req.method} ${req.originalUrl}`);
  next();
});

// (1) URL 정규화
router.post(
  "/normalize",
  passport.authenticate("jwt", { session: false }),
  normalizeUrlHandler
)

// (2) places 테이블 저장
router.post(
  "/store-place",
  passport.authenticate("jwt", { session: false }),
  storePlaceHandler
)

// (3) ChatGPT 키워드 생성
router.post(
  "/chatgpt",
  passport.authenticate("jwt", { session: false }),
  chatgptKeywordsHandler
)

// (4) 키워드 조합
router.post(
  "/combine",
  passport.authenticate("jwt", { session: false }),
  combineLocationAndFeaturesHandler
)

// (5) 검색량 조회
router.post(
  "/search-volume",
  passport.authenticate("jwt", { session: false }),
  searchVolumesHandler
)

// (6) 그룹핑
router.post(
  "/group",
  passport.authenticate("jwt", { session: false }),
  groupKeywordsHandler
)

router.post(
  "/save-grouped",
  passport.authenticate("jwt", { session: false }),
  saveGroupedKeywordsHandler
)

router.post(
  "/save-selected",
  passport.authenticate("jwt", { session: false }),
  saveSelectedKeywordsHandler
)

// 사용자 키워드 추가
router.post(
  "/user-keywords",
  passport.authenticate("jwt", { session: false }),
  addUserKeywordHandler
)

// 키워드 변경 - 디버그 로그 추가
router.post(
  "/change-user-keyword",
  (req, res, next) => {
    console.log("[DEBUG] change-user-keyword 라우트에 요청 도달:", req.body);
    next();
  },
  changeUserKeywordHandler
)

// 키워드 크롤링 상태 확인 엔드포인트 (ID로)
router.get(
  "/status/:keywordId",
  passport.authenticate("jwt", { session: false }),
  getKeywordStatusHandler
)

// 키워드 크롤링 상태 확인 엔드포인트 (키워드명으로)
router.get(
  "/status",
  passport.authenticate("jwt", { session: false }),
  getKeywordStatusHandler
)

export default router
