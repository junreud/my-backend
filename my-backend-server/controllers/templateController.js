import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import MessageTemplate from '../models/MessageTemplate.js';
import MessageTemplateItem from '../models/MessageTemplateItem.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('templateController');

// __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 이미지 파일 루트
const IMAGE_ROOT = path.resolve(__dirname, '../../my-frontend/public/images/datas');
logger.debug(`Image root directory: ${IMAGE_ROOT}`);

export const listImageFiles = async (req) => {
  logger.debug(`listImageFiles 요청, path=${req.query.path}`);
  const relPath = req.query.path || '';
  const safeRel = path.normalize(relPath).replace(/^\.\.(?:\/|\\|$)+/, '');
  const dirPath = path.join(IMAGE_ROOT, safeRel);

  if (!dirPath.startsWith(IMAGE_ROOT)) {
    logger.error(`Invalid path access. Base: ${IMAGE_ROOT}, Target: ${dirPath}`);
    const error = new Error('Invalid path');
    error.statusCode = 400;
    throw error;
  }

  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
      if (err) {
        logger.error(`readdir error: ${err.message}`, { code: err.code, dirPath });
        const error = new Error(err.code === 'ENOENT' ? 'Directory not found' : err.message);
        error.statusCode = err.code === 'ENOENT' ? 404 : 500;
        return reject(error);
      }
      const items = entries
        .filter(e => e.isDirectory() || /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(e.name))
        .map(e => ({ name: e.name, isDir: e.isDirectory() }));
      logger.debug(`listImageFiles 조회: ${items.length} entries`);
      resolve({ items });
    });
  });
};

export const getTemplates = async (req) => {
  logger.debug('getTemplates 요청');
  const templates = await MessageTemplate.findAll({ order: [['id', 'DESC']] });
  return templates;
};

export const getTemplateById = async (req) => {
  const { id } = req.params;
  logger.debug(`getTemplateById 요청: id=${id}`);
  const template = await MessageTemplate.findByPk(id, {
    include: [{ model: MessageTemplateItem, as: 'items', order: [['order', 'ASC']] }]
  });
  if (!template) {
    logger.error(`템플릿 없음: id=${id}`);
    const error = new Error('Not found');
    error.statusCode = 404;
    throw error;
  }
  return template;
};

export const createTemplate = async (req) => {
  logger.debug('createTemplate 요청', req.body);
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
  const createdTemplate = await MessageTemplate.findByPk(template.id, {
    include: [{ model: MessageTemplateItem, as: 'items', order: [['order', 'ASC']] }]
  });
  return { data: createdTemplate, message: 'Template created', statusCode: 201 };
};

export const updateTemplate = async (req) => {
  const { id } = req.params;
  logger.debug(`updateTemplate 요청: id=${id}`, req.body);
  const { name, description, items } = req.body;
  const template = await MessageTemplate.findByPk(id);
  if (!template) {
    logger.error(`업데이트할 템플릿 없음: id=${id}`);
    const error = new Error('Not found');
    error.statusCode = 404;
    throw error;
  }
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
  const updatedTemplate = await MessageTemplate.findByPk(template.id, {
    include: [{ model: MessageTemplateItem, as: 'items', order: [['order', 'ASC']] }]
  });
  return updatedTemplate;
};

export const deleteTemplate = async (req) => {
  const { id } = req.params;
  logger.debug(`deleteTemplate 요청: id=${id}`);
  const template = await MessageTemplate.findByPk(id);
  if (!template) {
    logger.error(`삭제할 템플릿 없음: id=${id}`);
    const error = new Error('Not found');
    error.statusCode = 404;
    throw error;
  }
  await template.destroy();
  return { message: 'Deleted' };
};
