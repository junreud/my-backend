import passport from 'passport';

// JWT 인증 미들웨어
export const authenticateJWT = passport.authenticate('jwt', { session: false });

// Admin 권한 검증 미들웨어
export const authenticateAdmin = [
  authenticateJWT,
  (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '관리자 권한이 필요한 작업입니다.' });
    }
    next();
  }
];

// 비동기 라우트 핸들러 에러 래퍼
/**
 * Wrap async route handlers to catch errors.
 * @param {Function} fn Async function to wrap
 */
export const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
