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
} from "../controllers/keywordController.js"

const router = express.Router()

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


export default router
