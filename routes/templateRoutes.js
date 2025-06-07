import express from 'express';
import { query, param, body } from 'express-validator';

// Controllers
import {
  listImageFiles,
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../controllers/templateController.js';

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors } from '../middlewares/common.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError, asyncHandler, logger } = createRouterWithAuth('templateRoutes');

// JWT 인증 및 요청 로깅 적용
router.use(authAndLog);

// 이미지 파일/폴더 목록 조회 엔드포인트
router.get(
  '/image-files',
  query('path').optional().isString(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await listImageFiles(req);
    return sendSuccess(res, result);
  })
);

// 템플릿 목록
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const templates = await getTemplates(req);
    return sendSuccess(res, templates);
  })
);

// 템플릿 상세
router.get(
  '/:id',
  param('id').isInt().withMessage('유효한 ID가 필요합니다.').toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const template = await getTemplateById(req);
    return sendSuccess(res, template);
  })
);

// 템플릿 생성
router.post(
  '/',
  body('name').notEmpty().withMessage('name 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const result = await createTemplate(req);
    return sendSuccess(res, result.data, result.message, result.statusCode);
  })
);

// 템플릿 수정
router.put(
   '/:id',
   param('id').isInt().toInt(),
   body('name').notEmpty(),
   handleValidationErrors,
   asyncHandler(async (req, res) => {
    const updatedTemplate = await updateTemplate(req);
    return sendSuccess(res, updatedTemplate);
   })
 );

// 템플릿 삭제
router.delete(
   '/:id',
   param('id').isInt().toInt(),
   handleValidationErrors,
   asyncHandler(async (req, res) => {
    const result = await deleteTemplate(req);
    return sendSuccess(res, {}, result.message);
   })
);

export default router;