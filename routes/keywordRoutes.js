// routes/keywordRoutes.js
import express from "express";
import { body, query, validationResult } from 'express-validator';

// Controllers & Services
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
  getMainKeywordStatusHandler,
  getKeywordRankingsByBusinessHandler,
  getKeywordHistoryHandler
} from "../controllers/keywordController.js";

// Utils & Middleware
import { authenticateJWT, asyncHandler } from '../middlewares/auth.js';
import { sendSuccess, sendError } from '../lib/response.js';
import createLogger from '../lib/logger.js';

const router = express.Router()
const logger = createLogger('keywordRoutes');

// 공통 JWT 인증
router.use(authenticateJWT)

// 라우터 레벨 미들웨어로 모든 요청에 대해 로그 추가
router.use((req, res, next) => {
  logger.debug(`키워드 라우터 요청: ${req.method} ${req.originalUrl}`);
  next();
});

// (1) URL 정규화
router.post(
  "/normalize",
  body('url').isURL().withMessage('올바른 URL이 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await normalizeUrlHandler(req, res);
    return sendSuccess(res, data);
  })
)

// (2) places 테이블 저장
router.post(
  "/store-place",
  body('place').exists().withMessage('place 정보가 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await storePlaceHandler(req, res);
    return sendSuccess(res, data);
  })
)

// (3) ChatGPT 키워드 생성
router.post(
  "/chatgpt",
  body('prompt').isString().withMessage('prompt 문자열이 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await chatgptKeywordsHandler(req, res);
    return sendSuccess(res, data);
  })
)

// (4) 키워드 조합
router.post(
  "/combine",
  body('location').isString().withMessage('location 문자열이 필요합니다.'),
  body('features').isArray().withMessage('features 배열이 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await combineLocationAndFeaturesHandler(req, res);
    return sendSuccess(res, data);
  })
)

// (5) 검색량 조회
router.post(
  "/search-volume",
  body('keywords').isArray().withMessage('keywords 배열이 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await searchVolumesHandler(req, res);
    return sendSuccess(res, data);
  })
)

// (6) 그룹핑
router.post(
  "/group",
  body('keywords').isArray().withMessage('keywords 배열이 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await groupKeywordsHandler(req, res);
    return sendSuccess(res, data);
  })
)

router.post(
  "/save-grouped",
  body('keywords').isArray().withMessage('keywords 배열이 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await saveGroupedKeywordsHandler(req, res);
    return sendSuccess(res, data);
  })
)

router.post(
  "/save-selected",
  body('keywords').isArray().withMessage('keywords 배열이 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await saveSelectedKeywordsHandler(req, res);
    return sendSuccess(res, data);
  })
)

// 사용자 키워드 추가
router.post(
  "/user-keywords",
  body('keyword').isString().withMessage('keyword 문자열이 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const data = await addUserKeywordHandler(req, res);
    return sendSuccess(res, data);
  })
)

// 키워드 변경 - 디버그 로그 추가
router.post(
  "/change-user-keyword",
  body('oldKeyword').isString().withMessage('oldKeyword 문자열이 필요합니다.'),
  body('newKeyword').isString().withMessage('newKeyword 문자열이 필요합니다.'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    logger.debug('change-user-keyword', req.body);
    const data = await changeUserKeywordHandler(req, res);
    return sendSuccess(res, data);
  })
)

// 키워드 메인 상태 확인 엔드포인트
router.get(
  '/main-status',
  asyncHandler(async (req, res) => {
    const data = await getMainKeywordStatusHandler(req, res);
    return sendSuccess(res, data);
  })
);

// 업체별 키워드 순위 조회 API
router.get(
  "/keyword-rankings-by-business",
  asyncHandler(async (req, res) => {
    const data = await getKeywordRankingsByBusinessHandler(req, res);
    return sendSuccess(res, data);
  })
);

// 업체별 키워드 히스토리 조회 (인증 필요)
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const data = await getKeywordHistoryHandler(req, res);
    return sendSuccess(res, data);
  })
);

export default router
