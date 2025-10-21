// routes/adminRoutes.js
import express from 'express';
import { query, body, param, validationResult } from 'express-validator';
import { Op } from 'sequelize';

// Controllers (Import new admin controllers)
import {
  getWorkHistoryOptions,
  getWorkHistories,
  createWorkHistoryEntry,
  deleteWorkHistoryEntry,
  getUsersWithPlaces
} from '../controllers/adminController.js';

// Models
import WorkHistory from '../models/WorkHistory.js';
import User from '../models/User.js';
import Place from '../models/Place.js';

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors } from '../middlewares/common.js';
import { workTypeOptions, executorOptions, filterOptions } from '../config/workHistoryOptions.js';

const router = express.Router();
const { adminAndLog, sendSuccess, sendError, asyncHandler, logger } = createRouterWithAuth('adminRoutes');

// 공통 관리자 인증 및 요청 로깅 적용
router.use(adminAndLog);

/**
 * GET /api/admin/work-histories/options
 * 관리자 전용 - 작업 이력 옵션 목록 조회 (작업 유형, 필터링 옵션 등)
 */
router.get(
  '/work-histories/options',
  asyncHandler(async (req, res) => {
    // logger.info(`관리자(${req.user.email})가 작업 이력 옵션 조회`); // Logging moved to controller
    const options = await getWorkHistoryOptions(req);
    return sendSuccess(res, options);
  })
);

// 관리자 전용 작업 이력 조회 API (최적화됨)
router.get(
  '/work-histories',
  query('limit').optional().isInt({ min: 1 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    // const { limit = 100, offset = 0 } = req.query;
    // logger.debug(`/work-histories 조회: limit=${limit}, offset=${offset}`); // Logging moved to controller
    const workHistories = await getWorkHistories(req);
    // logger.info(`관리자(${req.user.email})에게 ${workHistories.length}개 전송`); // Logging moved to controller
    return sendSuccess(res, workHistories);
  })
);

// 관리자 전용 작업 이력 생성 API
router.post(
  '/work-histories',
  body('user_id').isInt().toInt(),
  body('place_id').isInt().toInt(),
  body('work_type').isIn(workTypeOptions), // workTypeOptions should be available here or passed to controller if needed for validation logic there
  body('executor').isIn(executorOptions), // executorOptions should be available here or passed to controller
  handleValidationErrors, // handleValidationErrors will use validationResult
  asyncHandler(async (req, res) => {
    // const errors = validationResult(req); // Moved to handleValidationErrors middleware
    // if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const result = await createWorkHistoryEntry(req);
    // logger.info(`새 작업 이력 생성: ID ${newWH.id}`); // Logging moved to controller
    return sendSuccess(res, result.data, result.message, result.statusCode);
  })
);

// 관리자 전용 작업 이력 삭제 API
router.delete(
  '/work-histories/:id',
  param('id').isInt().toInt(),
  handleValidationErrors, // Added handleValidationErrors
  asyncHandler(async (req, res) => {
    // const errors = validationResult(req); // Moved to handleValidationErrors middleware
    // if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    // const id = req.params.id; // Logic moved to controller
    // const wh = await WorkHistory.findByPk(id); // Logic moved to controller
    // if (!wh) return sendError(res, 404, '없음'); // Logic moved to controller
    // await wh.destroy(); // Logic moved to controller
    const result = await deleteWorkHistoryEntry(req);
    // logger.info(`작업 이력 삭제: ID ${id}`); // Logging moved to controller
    return sendSuccess(res, result.data, result.message, result.statusCode);
  })
);

/**
 * GET /api/admin/users-with-places
 * 관리자 전용 API - 업체가 등록된 일반 사용자와 그들의 등록 업체 정보 조회
 */
router.get(
  '/users-with-places',
  asyncHandler(async (req, res) => {
    // logger.debug('users-with-places 조회'); // Logging moved to controller
    const formattedUsers = await getUsersWithPlaces(req);
    // logger.info(`관리자(${req.user.email})가 사용자 목록 조회: ${formattedUsers.length}명`); // Logging moved to controller
    return sendSuccess(res, formattedUsers);
  })
);

export default router;