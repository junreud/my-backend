// routes/authRoutes.js
import express from 'express';
import passport from 'passport';
import { body, validationResult } from 'express-validator';

// Controllers & Services
import authController, { issueTokens } from '../controllers/authController.js';

// Utils & Middleware
import createLogger from '../lib/logger.js';
import { authenticateJWT, asyncHandler } from '../middlewares/auth.js';
import { sendSuccess, sendError } from '../lib/response.js';
const router = express.Router();
const logger = createLogger('authRoutes');

// 공통 요청 로깅
router.use((req, res, next) => { logger.debug(`AuthRoutes 요청: ${req.method} ${req.originalUrl}`); next(); });
// OAuth 라우트 설정 로그
logger.debug('OAuth 라우트 설정 완료');

const isDevelopment = () => process.env.NODE_ENV === 'development';
// Always secure cookies for sameSite='none' cross-site scenarios (dev and prod)
const getSecureCookieSetting = () => true;

// 환경에 따른 프론트엔드 URL 설정
const getFrontendUrl = () => {
  return process.env.NODE_ENV === 'development' 
    ? 'https://localhost:3000' 
    : process.env.FRONTEND_URL || 'https://lakabe.com';
};

router.post(
  '/login',
  body('email').isEmail().withMessage('유효한 이메일이 필요합니다.'),
  body('password').notEmpty().withMessage('비밀번호가 필요합니다.'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    logger.debug('/login 요청 수신');
    passport.authenticate('local', { session: false }, async (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        return sendError(res, 401, info?.message || 'Auth Failed');
      }

      try {
        // 토큰 발급
        const tokens = await issueTokens(user.id);

        // (1) RefreshToken -> HttpOnly 쿠키
        res.cookie('refreshToken', tokens.refreshToken, {
          httpOnly: true,
          secure: getSecureCookieSetting(),
          sameSite: 'none',
          path: '/',
        });
        // (2) AccessToken -> HttpOnly 쿠키 (for SSR token retrieval)
        res.cookie('token', tokens.accessToken, {
          httpOnly: true,
          secure: getSecureCookieSetting(),
          sameSite: 'none',
          path: '/',
        });
        // (3) 로그인 성공 응답
        return sendSuccess(res, {}, '로그인 성공!');
      } catch (error) {
        logger.error('issueTokens 오류:', error);
        return sendError(res, 500, '토큰 발급 실패');
      }
    })(req, res, next);
  })
);

// ----- 구글 OAuth -----
router.get(
  '/google',
  (req, res, next) => {
    logger.debug('Google OAuth 인증 요청 시작');
    passport.authenticate('google', { scope: ['email', 'profile'] })(req, res, next);
  }
);

router.get('/google/callback', (req, res, next) => {
  logger.debug('Google OAuth 콜백 요청 수신');
  passport.authenticate('google', { session: false }, async (err, user, info) => {
    if (err) {
      logger.error('Google OAuth 콜백 에러:', err);
      return next(err);
    }

    // 인증 실패 시
    if (!user) {
      // 이메일 중복 등 특정 케이스라면 프론트로 리다이렉트
      if (info && info.message === 'EMAIL_CONFLICT') {
        const { email, googleId } = info;
        const frontendUrl = getFrontendUrl();
        return res.redirect(
          `${frontendUrl}/link-accounts?email=${encodeURIComponent(email)}&googleSub=${encodeURIComponent(googleId)}&provider=google`
        );
      } else {
        return sendError(res, 400, info?.message || '구글 로그인 실패');
      }
    }

    // 구글 인증 성공
    if (!user.is_completed) {
      // 추가정보 필요 페이지로
      const frontendUrl = getFrontendUrl();
      return res.redirect(
        `${frontendUrl}/add-info?email=${encodeURIComponent(user.email)}&provider=google`
      );
    } else {
      // (1) 가입완료 → 토큰 발급
      try {
        const tokens = await issueTokens(user.id);
        // (2) refreshToken을 쿠키로
        res.cookie('refreshToken', tokens.refreshToken, {
          httpOnly: true,
          secure: getSecureCookieSetting(),
          sameSite: 'none',
          path: '/',
        });
        
        // (3) accessToken은 쿼리파람으로 넘겨주고, 프론트에서 localStorage에 저장 가능
        const frontendUrl = getFrontendUrl();
        return res.redirect(
          `${frontendUrl}/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        logger.error('Google OAuth issueTokens 오류:', error);
        const frontendUrl = getFrontendUrl();
        return res.redirect(`${frontendUrl}/login?error=token_issue`);
      }
    }
  })(req, res, next);
});

// ----- 카카오 OAuth -----
router.get(
  '/kakao',
  (req, res, next) => {
    logger.debug('Kakao OAuth 인증 요청 시작');
    passport.authenticate('kakao')(req, res, next);
  }
);

router.get("/kakao/callback", (req, res, next) => {
  logger.debug('Kakao OAuth 콜백 요청 수신');
  passport.authenticate("kakao", { session: false }, async (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      // message: EMAIL_CONFLICT_LOCAL => 로컬 계정과 충돌
      if (info && info.message === "EMAIL_CONFLICT_LOCAL") {
        const { email, kakaoId } = info;
        const frontendUrl = getFrontendUrl();
        return res.redirect(
          `${frontendUrl}/link-accounts?email=${encodeURIComponent(email)}&provider=kakao&providerId=${encodeURIComponent(kakaoId)}&mode=localLink`
        );
      } 
      // message: EMAIL_IN_USE_SOCIAL => 소셜 vs 소셜
      else if (info && info.message === "EMAIL_IN_USE_SOCIAL") {
        return sendError(res, 400, '이미 소셜로 가입된 이메일 - 가입 불가');
      } 
      else {
        return sendError(res, 400, info?.message || '카카오 로그인 실패');
      }
    }

    // 이미 (provider='kakao', provider_id=kakaoId)로 가입된 유저 or 새로 생성된 유저
    if (!user.is_completed) {
      const frontendUrl = getFrontendUrl();
      return res.redirect(
        `${frontendUrl}/add-info?email=${encodeURIComponent(user.email)}&provider=kakao`
      );
    } else {
      try {
        const tokens = await issueTokens(user.id);
        res.cookie("refreshToken", tokens.refreshToken, {
          httpOnly: true,
          secure: getSecureCookieSetting(),
          sameSite: "none",
          path: '/',
        });
        const frontendUrl = getFrontendUrl();
        return res.redirect(
          `${frontendUrl}/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        logger.error('Kakao OAuth issueTokens 오류:', error);
        const frontendUrl = getFrontendUrl();
        return res.redirect(`${frontendUrl}/login?error=token_issue`);
      }
    }
  })(req, res, next);
});

// 기타 라우트들
router.post(
  '/signup',
  body('email').isEmail().withMessage('유효한 이메일이 필요합니다.'),
  body('password').notEmpty().withMessage('비밀번호가 필요합니다.'),
  asyncHandler(authController.signup)
);
router.post(
  '/verify',
  body('token').notEmpty().withMessage('검증 토큰이 필요합니다.'),
  asyncHandler(authController.verify)
);
router.post(
  '/check-email',
  body('email').isEmail().withMessage('유효한 이메일이 필요합니다.'),
  asyncHandler(authController.checkEmail)
);
router.post(
  '/check-email-and-password',
  body('email').isEmail().withMessage('유효한 이메일이 필요합니다.'),
  body('password').notEmpty().withMessage('비밀번호가 필요합니다.'),
  asyncHandler(authController.checkEmailAndPassword)
);
router.post(
  '/link-accounts',
  body('email').isEmail().withMessage('유효한 이메일이 필요합니다.'),
  body('provider').notEmpty().withMessage('provider가 필요합니다.'),
  asyncHandler(authController.linkAccounts)
);
router.post(
  '/addinfo',
  authenticateJWT,
  body('userInfo').notEmpty().withMessage('추가 정보가 필요합니다.'),
  asyncHandler(authController.addInfo)
);
router.post(
  '/refresh',
  authenticateJWT,
  asyncHandler(authController.refresh)
);
// 로그아웃 라우트 (토큰 제거)
router.post(
  '/logout',
  authenticateJWT,
  asyncHandler(authController.logout)
);

export default router;
