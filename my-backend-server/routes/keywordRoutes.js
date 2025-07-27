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
  getKeywordHistoryHandler,
  getKeywordRankingTableHandler,
  updateMainKeywordHandler
} from "../controllers/keywordController.js";

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors, asyncHandler } from '../middlewares/common.js';

const router = express.Router()
const { authAndLog, sendSuccess, sendError, logger } = createRouterWithAuth('keywordRoutes');

// 공통 JWT 인증 및 로깅
router.use(authAndLog);

// (1) URL 정규화
router.post(
  "/normalize",
  body('url').isURL().withMessage('올바른 URL이 필요합니다.'),
  body('platform').notEmpty().withMessage('platform이 필요합니다.'), // Added platform validation
  handleValidationErrors, // Added common validation error handler
  asyncHandler(async (req, res) => {
    const data = await normalizeUrlHandler(req);
    return sendSuccess(res, data);
  })
)

// (2) places 테이블 저장
router.post(
  "/store-place",
  body('user_id').isInt().withMessage('user_id는 정수여야 합니다.'),
  body('place_id').isString().notEmpty().withMessage('place_id는 문자열이어야 합니다.'),
  body('place_name').isString().notEmpty().withMessage('place_name은 문자열이어야 합니다.'),
  body('category').optional().isString(),
  body('platform').optional().isString(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await storePlaceHandler(req);
    return sendSuccess(res, result.data, result.message);
  })
)

// (3) ChatGPT 키워드 생성
router.post(
  "/chatgpt",
  body('placeInfo').isObject().withMessage('placeInfo 객체가 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const data = await chatgptKeywordsHandler(req);
    return sendSuccess(res, data);
  })
)

// (4) 키워드 조합
router.post(
  "/combine",
  body('locationKeywords').isArray().withMessage('locationKeywords 배열이 필요합니다.'),
  body('featureKeywords').isArray().withMessage('featureKeywords 배열이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const data = await combineLocationAndFeaturesHandler(req);
    return sendSuccess(res, data);
  })
)

// (5) 검색량 조회
router.post(
  "/search-volume",
  body('candidateKeywords').isArray().withMessage('candidateKeywords 배열이 필요합니다.'),
  body('normalizedUrl').optional().isURL().withMessage('normalizedUrl은 유효한 URL이어야 합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const data = await searchVolumesHandler(req);
    return sendSuccess(res, data);
  })
)

// (6) 그룹핑
router.post(
  "/group",
  body('externalDataList').isArray().withMessage('externalDataList 배열이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await groupKeywordsHandler(req);
    return sendSuccess(res, result, result.message);
  })
)

router.post(
  "/save-grouped",
  body('finalKeywords').isArray().withMessage('finalKeywords 배열이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await saveGroupedKeywordsHandler(req);
    return sendSuccess(res, result.data, result.message);
  })
)

router.post(
  "/save-selected",
  body('placeId').isInt().withMessage('placeId는 정수여야 합니다.'),
  body('keywords').isArray().withMessage('keywords 배열이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await saveSelectedKeywordsHandler(req);
    return sendSuccess(res, result.data, result.message);
  })
)

// 사용자 키워드 추가
router.post(
  "/user-keywords",
  body('userId').isInt().withMessage('userId는 정수여야 합니다.'),
  body('placeId').isInt().withMessage('placeId는 정수여야 합니다.'),
  body('keyword').isString().notEmpty().withMessage('keyword 문자열이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await addUserKeywordHandler(req);
    return sendSuccess(res, result.data, result.message, result.statusCode);
  })
)

// 키워드 변경 - 디버그 로그 추가
router.post(
  "/change-user-keyword",
  body('userId').isInt().withMessage('userId는 정수여야 합니다.'),
  body('placeId').isInt().withMessage('placeId는 정수여야 합니다.'),
  body('oldKeywordId').isInt().withMessage('oldKeywordId는 정수여야 합니다.'),
  body('newKeyword').isString().notEmpty().withMessage('newKeyword 문자열이 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('change-user-keyword', req.body);
    const result = await changeUserKeywordHandler(req);
    return sendSuccess(res, result.data, result.message);
  })
)

// 키워드 메인 상태 확인 엔드포인트
router.get(
  '/main-status',
  asyncHandler(async (req, res) => {
    const data = await getMainKeywordStatusHandler(req);
    return sendSuccess(res, data);
  })
);

// 업체별 키워드 순위 조회 API
router.get(
  "/keyword-rankings-by-business",
  query('placeId').notEmpty().withMessage('placeId는 필수입니다.'), // placeId can be string or number
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const data = await getKeywordRankingsByBusinessHandler(req);
    return sendSuccess(res, data);
  })
);

// 키워드별 순위 테이블 조회 API (1위~300위 모든 업체)
router.get(
  "/keyword-ranking-table",
  query('keyword').notEmpty().withMessage('keyword는 필수입니다.'),
  query('placeId').notEmpty().withMessage('placeId는 필수입니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const data = await getKeywordRankingTableHandler(req);
    return sendSuccess(res, data);
  })
);

// 업체별 키워드 히스토리 조회 (인증 필요)
router.get(
  "/history",
  query('placeId').isInt().withMessage('placeId는 정수여야 합니다.'),
  query('keywordId').isInt().withMessage('keywordId는 정수여야 합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const data = await getKeywordHistoryHandler(req);
    return sendSuccess(res, data);
  })
);

// 메인 키워드 변경 (인증 필요)
router.patch(
  "/main-keyword/:placeId",
  body('keywordId').isInt().withMessage('keywordId는 정수여야 합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const data = await updateMainKeywordHandler(req);
    return sendSuccess(res, data);
  })
);

export default router
