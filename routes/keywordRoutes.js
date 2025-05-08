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
  getMainKeywordStatusHandler, // 추가: 메인 키워드 상태 확인 핸들러
  getKeywordRankingsByBusinessHandler, // 추가: 업체별 키워드 순위 조회 핸들러
} from "../controllers/keywordController.js"

const router = express.Router()
// 재사용 가능한 JWT 인증 미들웨어 정의
const authenticateJWT = passport.authenticate("jwt", { session: false });

// 라우터 레벨 미들웨어로 모든 요청에 대해 로그 추가
router.use((req, res, next) => {
  console.log(`[ROUTER DEBUG] 키워드 라우터 요청: ${req.method} ${req.originalUrl}`);
  next();
});

// (1) URL 정규화
router.post(
  "/normalize",
  authenticateJWT,
  normalizeUrlHandler
)

// (2) places 테이블 저장
router.post(
  "/store-place",
  authenticateJWT,
  storePlaceHandler
)

// (3) ChatGPT 키워드 생성
router.post(
  "/chatgpt",
  authenticateJWT,
  chatgptKeywordsHandler
)

// (4) 키워드 조합
router.post(
  "/combine",
  authenticateJWT,
  combineLocationAndFeaturesHandler
)

// (5) 검색량 조회
router.post(
  "/search-volume",
  authenticateJWT,
  searchVolumesHandler
)

// (6) 그룹핑
router.post(
  "/group",
  authenticateJWT,
  groupKeywordsHandler
)

router.post(
  "/save-grouped",
  authenticateJWT,
  saveGroupedKeywordsHandler
)

router.post(
  "/save-selected",
  authenticateJWT,
  saveSelectedKeywordsHandler
)

// 사용자 키워드 추가
router.post(
  "/user-keywords",
  authenticateJWT,
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
  getKeywordStatusHandler
)

// 키워드 크롤링 상태 확인 엔드포인트 (키워드명으로)
router.get(
  "/status",
  getKeywordStatusHandler
)

// 키워드 메인 상태 확인 엔드포인트
router.get(
  '/main-status',
  authenticateJWT,
  getMainKeywordStatusHandler
);

// 업체별 키워드 순위 조회 API
router.get(
  "/keyword-rankings-by-business",
  authenticateJWT, 
  getKeywordRankingsByBusinessHandler
);

export default router
