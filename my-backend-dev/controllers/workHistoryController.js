import { createLogger } from '../lib/logger.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';
import WorkHistory from '../models/WorkHistory.js';

const logger = createLogger('WorkHistoryController');

/**
 * 사용자의 작업 이력 조회
 */
export const getUserWorkHistoriesHandler = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({ 
    controllerName: 'WorkHistoryController', 
    actionName: 'getUserWorkHistories' 
  });
  
  try {
    const { userId } = req.params;
    const requestUserId = req.user?.id || req.user?.userId;
    
    controllerLogger.info(`작업 이력 조회 요청 - userId: ${userId}, requestUserId: ${requestUserId}`);
    
    // 사용자 권한 확인 (자신의 작업 이력만 조회 가능)
    if (String(userId) !== String(requestUserId)) {
      const error = new Error('권한이 없습니다.');
      error.statusCode = 403;
      throw error;
    }
    
    // 작업 이력 조회
    const workHistories = await handleDbOperation(async () => {
      return WorkHistory.findAll({
        where: { user_id: userId },
        order: [['created_at', 'DESC']],
        raw: true
      });
    }, "작업 이력 조회");
    
    controllerLogger.info(`작업 이력 조회 완료 - 총 ${workHistories.length}개`);
    
    return workHistories || [];
    
  } catch (error) {
    controllerLogger.error('작업 이력 조회 실패', error);
    throw error;
  }
};
