// routes/adminRoutes.js
import express from 'express';
import { query, body, param } from 'express-validator';
import { Op } from 'sequelize';

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
    logger.info(`관리자(${req.user.email})가 작업 이력 옵션 조회`);
    return sendSuccess(res, { workTypes: workTypeOptions, executors: executorOptions, filters: filterOptions });
  })
);

// 관리자 전용 작업 이력 조회 API (최적화됨)
router.get(
  '/work-histories',
  query('limit').optional().isInt({ min: 1 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    logger.debug(`/work-histories 조회: limit=${limit}, offset=${offset}`);
    const workHistories = await WorkHistory.findAll({ limit, offset, order: [['id', 'DESC']] });
    logger.info(`관리자(${req.user.email})에게 ${workHistories.length}개 전송`);
    return sendSuccess(res, workHistories);
  })
);

// 관리자 전용 작업 이력 생성 API
router.post(
  '/work-histories',
  body('user_id').isInt().toInt(),
  body('place_id').isInt().toInt(),
  body('work_type').isIn(workTypeOptions),
  body('executor').isIn(executorOptions),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const newWH = await WorkHistory.createWorkHistory(req.body);
    logger.info(`새 작업 이력 생성: ID ${newWH.id}`);
    return sendSuccess(res, newWH, '생성 완료', 201);
  })
);

// 관리자 전용 작업 이력 삭제 API
router.delete(
  '/work-histories/:id',
  param('id').isInt().toInt(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    const id = req.params.id;
    const wh = await WorkHistory.findByPk(id);
    if (!wh) return sendError(res, 404, '없음');
    await wh.destroy();
    logger.info(`작업 이력 삭제: ID ${id}`);
    return sendSuccess(res, {}, '삭제 완료');
  })
);

/**
 * GET /api/admin/users-with-places
 * 관리자 전용 API - 업체가 등록된 일반 사용자와 그들의 등록 업체 정보 조회
 */
router.get(
  '/users-with-places',
  asyncHandler(async (req, res) => {
    logger.debug('users-with-places 조회');
    const users = await User.findAll({
      where: { role: { [Op.ne]: 'admin' } },
      attributes: ['id', 'name', 'email', 'phone'],
      include: [{ model: Place, as: 'places', attributes: ['id', 'place_name'], required: true }]
    });
    const formattedUsers = users.map(user => ({
      user_id: user.id,
      name: user.name || '이름 없음',
      email: user.email || '이메일 없음',
      phone: user.phone || '연락처 없음',
      place_names: user.places.map(p => p.place_name),
      place_ids: user.places.map(p => String(p.id)),
      place_count: user.places.length
    }));
    logger.info(`관리자(${req.user.email})가 사용자 목록 조회: ${formattedUsers.length}명`);
    return sendSuccess(res, formattedUsers);
  })
);

export default router;