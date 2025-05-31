import express from 'express';
import { query, param, body } from 'express-validator';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Models
import MessageTemplate from '../models/MessageTemplate.js';
import MessageTemplateItem from '../models/MessageTemplateItem.js';

// Utils & Middleware
import { createRouterWithAuth, handleValidationErrors } from '../middlewares/common.js';

const router = express.Router();
const { authAndLog, sendSuccess, sendError, asyncHandler, logger } = createRouterWithAuth('templateRoutes');

// __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JWT 인증 및 요청 로깅 적용
router.use(authAndLog);

// 이미지 파일 루트
const IMAGE_ROOT = path.resolve(__dirname, '../../my-frontend/public/images/datas');
logger.debug(`Image root directory: ${IMAGE_ROOT}`); // 서버 시작 시 로그 추가

// 이미지 파일/폴더 목록 조회 엔드포인트
router.get(
  '/image-files',
  query('path').optional().isString(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug(`image-files 요청, path=${req.query.path}`);
    const relPath = req.query.path || '';
    const safeRel = path.normalize(relPath).replace(/^\.\.(?:\/|\\|$)+/, '');
    const dirPath = path.join(IMAGE_ROOT, safeRel);
    if (!dirPath.startsWith(IMAGE_ROOT)) {
      logger.error(`Invalid path access. Base: ${IMAGE_ROOT}, Target: ${dirPath}`);
      return sendError(res, 400, 'Invalid path');
    }
    fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
      if (err) {
        if (err.code === 'ENOENT') {
          logger.error(`Directory not found: ${dirPath}`);
          return sendError(res, 404, 'Directory not found');
        }
        logger.error(`readdir error: ${err.message}`);
        return sendError(res, 500, err.message);
      }
      const items = entries
        .filter(e => e.isDirectory() || /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(e.name))
        .map(e => ({ name: e.name, isDir: e.isDirectory() }));
      logger.debug(`image-files 조회: ${items.length} entries`);
      return sendSuccess(res, { items });
    });
  })
);

// 템플릿 목록
router.get(
  '/',
  asyncHandler(async (req, res) => {
    logger.debug('fetch templates 명령');
    const templates = await MessageTemplate.findAll({ order: [['id', 'DESC']] });
    return sendSuccess(res, templates);
  })
);

// 템플릿 상세
router.get(
  '/:id',
  param('id').isInt().withMessage('유효한 ID가 필요합니다.').toInt(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug(`fetch template 상세: id=${req.params.id}`);
    const template = await MessageTemplate.findByPk(req.params.id, {
      include: [{ model: MessageTemplateItem, as: 'items', order: [['order', 'ASC']] }]
    });
    if (!template) {
      logger.error(`템플릿 없음: id=${req.params.id}`);
      return sendError(res, 404, 'Not found');
    }
    return sendSuccess(res, template);
  })
);

// 템플릿 생성
router.post(
  '/',
  body('name').notEmpty().withMessage('name 필요합니다.'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    logger.debug('create template 요청', req.body);
    const { name, description, items } = req.body;
    const template = await MessageTemplate.create({ name, description });
    if (Array.isArray(items)) {
      for (const [i, item] of items.entries()) {
        await MessageTemplateItem.create({
          template_id: template.id,
          order: i + 1,
          type: item.type,
          content: item.type === 'image' && Array.isArray(item.content)
            ? item.content.join(',')
            : item.content,
        });
      }
    }
    const created = await MessageTemplate.findByPk(template.id, {
      include: [{ model: MessageTemplateItem, as: 'items', order: [['order', 'ASC']] }]
    });
    return sendSuccess(res, created, 'Template created', 201);
  })
);

// 템플릿 수정
router.put(
   '/:id',
   param('id').isInt().toInt(),
   body('name').notEmpty(),
   handleValidationErrors,
   asyncHandler(async (req, res) => {
     logger.debug(`update template id=${req.params.id}`, req.body);
     const { name, description, items } = req.body;
     const template = await MessageTemplate.findByPk(req.params.id);
     if (!template) return sendError(res, 404, 'Not found');
     await template.update({ name, description });

     // 기존 아이템 모두 삭제
     await MessageTemplateItem.destroy({ where: { template_id: template.id } });

     // 새 아이템 일괄 생성
     if (Array.isArray(items)) {
       for (const [i, item] of items.entries()) {
         await MessageTemplateItem.create({
           template_id: template.id,
           order: i + 1,
           type: item.type,
           content: item.type === 'image' && Array.isArray(item.content)
             ? item.content.join(',')
             : item.content,
         });
       }
     }

     // 응답에 템플릿+아이템 포함
     const updated = await MessageTemplate.findByPk(template.id, {
       include: [{ model: MessageTemplateItem, as: 'items', order: [['order', 'ASC']] }]
     });
     return sendSuccess(res, updated);
   })
 );

// 템플릿 삭제
router.delete(
   '/:id',
   param('id').isInt().toInt(),
   handleValidationErrors,
   asyncHandler(async (req, res) => {
     logger.debug(`delete template id=${req.params.id}`);
     const template = await MessageTemplate.findByPk(req.params.id);
     if (!template) return sendError(res, 404, 'Not found');
     await template.destroy();
     return sendSuccess(res, {}, 'Deleted');
   })
);

export default router;