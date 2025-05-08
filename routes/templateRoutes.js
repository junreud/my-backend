import express from 'express';
import MessageTemplate from '../models/MessageTemplate.js';
import MessageTemplateItem from '../models/MessageTemplateItem.js';
import fs from 'fs';
import path from 'path';
import passport from 'passport';
import { fileURLToPath } from 'url';

// __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JWT 인증 미들웨어
const authenticateJWT = passport.authenticate('jwt', { session: false });

// 이미지 파일 루트 (my-frontend/public/images/datas) - kakaoController와 동일한 방식으로 수정
const IMAGE_ROOT = path.resolve(__dirname, '../../my-frontend/public/images/datas');
console.log(`[TemplateRoutes] Image root directory set to: ${IMAGE_ROOT}`); // 서버 시작 시 로그 추가

const router = express.Router();

// 이미지 파일/폴더 목록 조회 엔드포인트
router.get('/image-files', authenticateJWT, async (req, res) => {
  const relPath = req.query.path || '';
  // 경로 조작 방지 강화
  const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const dirPath = path.join(IMAGE_ROOT, safeRel);

  // 디버그 로그 위치 및 내용 수정
  console.log(`DEBUG image-files: requested path='${relPath}', safeRel='${safeRel}', resolved dirPath='${dirPath}'`);

  if (!dirPath.startsWith(IMAGE_ROOT)) {
    console.error(`ERROR image-files: Invalid path access attempt. Base: ${IMAGE_ROOT}, Target: ${dirPath}`);
    return res.status(400).json({ error: 'Invalid path' });
  }
  fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
    if (err) {
      console.error(`ERROR image-files: Failed to read directory ${dirPath}`, err);
      // ENOENT 에러는 404로 처리하는 것이 더 적절할 수 있음
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Directory not found' });
      }
      return res.status(500).json({ error: err.message });
    }
    const items = entries
      .filter(e => e.isDirectory() || /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(e.name)) // 이미지 확장자 필터링 추가
      .map(e => ({ name: e.name, isDir: e.isDirectory() }));
    res.json({ items });
  });
});

// 템플릿 목록
router.get('/', authenticateJWT, async (req, res) => {
  const templates = await MessageTemplate.findAll({ order: [['id', 'DESC']] });
  res.json(templates);
});

// 템플릿 상세 (메시지 시퀀스 포함)
router.get('/:id', authenticateJWT,  async (req, res) => {
  const template = await MessageTemplate.findByPk(req.params.id, {
    include: [{ model: MessageTemplateItem, as: 'items', order: [['order', 'ASC']] }]
  });
  if (!template) return res.status(404).json({ error: 'Not found' });
  res.json(template);
});

// 템플릿 생성 및 아이템 동기화
router.post('/', authenticateJWT, async (req, res) => {
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
  res.json(created);
});

// 템플릿 수정 및 아이템 동기화
router.put('/:id', authenticateJWT, async (req, res) => {
  const { name, description, items } = req.body;
  const template = await MessageTemplate.findByPk(req.params.id);
  if (!template) return res.status(404).json({ error: 'Not found' });
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
  res.json(updated);
});

// 템플릿 삭제
router.delete('/:id', authenticateJWT, async (req, res) => {
  const template = await MessageTemplate.findByPk(req.params.id);
  if (!template) return res.status(404).json({ error: 'Not found' });
  await template.destroy();
  res.json({ success: true });
});

// 템플릿 메시지(아이템) 추가
router.post('/:id/items', authenticateJWT, async (req, res) => {
  const { order, type, content } = req.body;
  const item = await MessageTemplateItem.create({
    template_id: req.params.id, order, type, content
  });
  res.json(item);
});

// 템플릿 메시지(아이템) 수정
router.put('/:id/items/:itemId', authenticateJWT, async (req, res) => {
  const { order, type, content } = req.body;
  const item = await MessageTemplateItem.findByPk(req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  await item.update({ order, type, content });
  res.json(item);
});

// 템플릿 메시지(아이템) 삭제
router.delete('/:id/items/:itemId', authenticateJWT, async (req, res) => {
  const item = await MessageTemplateItem.findByPk(req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  await item.destroy();
  res.json({ success: true });
});

// 템플릿 복사 API
router.post('/:id/copy', authenticateJWT, async (req, res) => {
  const origTemplate = await MessageTemplate.findByPk(req.params.id, {
    include: [{ model: MessageTemplateItem, as: 'items', order: [['order', 'ASC']] }]
  });
  if (!origTemplate) return res.status(404).json({ error: 'Not found' });
  // 새 템플릿 생성 (이름에 복사본 표시)
  const newTemplate = await MessageTemplate.create({
    name: origTemplate.name + ' (복사본)',
    description: origTemplate.description
  });
  // 아이템 복사
  if (origTemplate.items && origTemplate.items.length > 0) {
    for (const item of origTemplate.items) {
      await MessageTemplateItem.create({
        template_id: newTemplate.id,
        order: item.order,
        type: item.type,
        content: item.content
      });
    }
  }
  // 복사된 템플릿+아이템 반환
  const copied = await MessageTemplate.findByPk(newTemplate.id, {
    include: [{ model: MessageTemplateItem, as: 'items', order: [['order', 'ASC']] }]
  });
  res.json(copied);
});

export default router;