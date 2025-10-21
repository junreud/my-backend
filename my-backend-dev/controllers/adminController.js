import WorkHistory from '../models/WorkHistory.js';
import User from '../models/User.js';
import Place from '../models/Place.js';
import { Op } from 'sequelize';
import { createControllerHelper } from '../utils/controllerHelpers.js';
import { workTypeOptions, executorOptions, filterOptions } from '../config/workHistoryOptions.js';

const { handleDbOperation, logger } = createControllerHelper('AdminController');

export const getWorkHistoryOptions = async (req) => {
  logger.info(`관리자(${req.user.email})가 작업 이력 옵션 조회 요청`);
  return { workTypes: workTypeOptions, executors: executorOptions, filters: filterOptions };
};

export const getWorkHistories = async (req) => {
  const { limit = 100, offset = 0 } = req.query;
  logger.info(`관리자(${req.user.email})가 작업 이력 조회 요청: limit=${limit}, offset=${offset}`);
  const workHistories = await handleDbOperation(
    () => WorkHistory.findAll({ limit, offset, order: [['id', 'DESC']] }),
    '관리자 작업 이력 조회'
  );
  logger.info(`${workHistories.length}개의 작업 이력을 반환합니다.`);
  return workHistories;
};

export const createWorkHistoryEntry = async (req) => {
  const { user_id, place_id, work_type, executor } = req.body;
  logger.info(`관리자(${req.user.email})가 새 작업 이력 생성 요청: user_id=${user_id}, place_id=${place_id}`);
  const newWH = await handleDbOperation(
    () => WorkHistory.createWorkHistory({ user_id, place_id, work_type, executor }), // Assuming createWorkHistory is a static method on the model
    '관리자 작업 이력 생성'
  );
  logger.info(`새 작업 이력 생성 완료: ID ${newWH.id}`);
  return { data: newWH, message: '생성 완료', statusCode: 201 };
};

export const deleteWorkHistoryEntry = async (req) => {
  const { id } = req.params;
  logger.info(`관리자(${req.user.email})가 작업 이력 삭제 요청: ID ${id}`);
  const wh = await handleDbOperation(
    () => WorkHistory.findByPk(id),
    `작업 이력 조회 (ID: ${id})`
  );

  if (!wh) {
    const error = new Error('삭제할 작업 이력을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  await handleDbOperation(
    () => wh.destroy(),
    `작업 이력 삭제 (ID: ${id})`
  );
  logger.info(`작업 이력 삭제 완료: ID ${id}`);
  return { message: '삭제 완료', statusCode: 200 }; // Or 204 No Content, but sendSuccess expects data or message
};

export const getUsersWithPlaces = async (req) => {
  logger.info(`관리자(${req.user.email})가 업체 등록된 사용자 목록 조회 요청`);
  const users = await handleDbOperation(
    () => User.findAll({
      where: { role: { [Op.ne]: 'admin' } },
      attributes: ['id', 'name', 'email', 'phone'],
      // Include places even if a user has none (required: false)
      include: [{ model: Place, as: 'places', attributes: ['id', 'place_name'], required: false }]
    }),
    '업체 등록된 일반 사용자 및 업체 정보 조회'
  );

  const formattedUsers = users.map(user => ({
    user_id: user.id,
    name: user.name || '이름 없음',
    email: user.email || '이메일 없음',
    phone: user.phone || '연락처 없음',
    place_names: user.places.map(p => p.place_name),
    place_ids: user.places.map(p => String(p.id)),
    place_count: user.places.length
  }));
  logger.info(`조회된 사용자 수: ${formattedUsers.length}명`);
  return formattedUsers;
};
