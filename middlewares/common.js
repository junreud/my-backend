// middlewares/common.js
import { validationResult } from 'express-validator';
import { authenticateJWT, authenticateAdmin, asyncHandler } from './auth.js';
import { sendSuccess, sendError } from '../lib/response.js';
import createLogger from '../lib/logger.js';

/**
 * 공통 라우터 미들웨어 팩토리
 * JWT 인증 + 요청 로깅을 통합
 */
export function createRouterWithAuth(routeName) {
  const logger = createLogger(routeName);
  
  return {
    // JWT 인증 + 요청 로깅 미들웨어
    authAndLog: [
      authenticateJWT,
      (req, res, next) => {
        logger.debug(`${routeName} 요청: ${req.method} ${req.originalUrl}`);
        next();
      }
    ],
    
    // 관리자 전용 + 요청 로깅 미들웨어
    adminAndLog: [
      authenticateAdmin,
      (req, res, next) => {
        logger.debug(`${routeName} 관리자 요청: ${req.method} ${req.originalUrl}`);
        next();
      }
    ],
    
    // 응답 헬퍼
    sendSuccess: (res, data, message = 'Success', status = 200) => {
      return sendSuccess(res, data, message, status);
    },
    
    sendError: (res, status, message, details = null) => {
      return sendError(res, status, message, details);
    },
    
    // 비동기 핸들러
    asyncHandler,
    
    // 로거
    logger
  };
}

/**
 * 공통 검증 에러 처리
 */
export function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError(res, 400, '검증 오류', errors.array());
  }
  next();
}

/**
 * 표준 CRUD 응답 헬퍼
 */
export const responseHelpers = {
  success: (res, data, message = 'Success') => sendSuccess(res, data, message),
  created: (res, data, message = 'Created') => sendSuccess(res, data, message, 201),
  error: (res, status = 500, message = 'Internal Server Error') => sendError(res, status, message),
  notFound: (res, message = 'Not Found') => sendError(res, 404, message),
  badRequest: (res, message = 'Bad Request') => sendError(res, 400, message),
  unauthorized: (res, message = 'Unauthorized') => sendError(res, 401, message),
  forbidden: (res, message = 'Forbidden') => sendError(res, 403, message)
};

// asyncHandler를 직접 export하여 다른 모듈에서 import 가능하도록 수정
export { asyncHandler };
