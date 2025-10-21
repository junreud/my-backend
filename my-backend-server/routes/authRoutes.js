// routes/authRoutes.js
import express from 'express';
import passport from 'passport';
import { body, validationResult } from 'express-validator';

// Controllers & Services
import authController, { issueTokens } from '../controllers/authController.js';

// Utils & Middleware
import createLogger from '../lib/logger.js';
import { authenticateJWT, asyncHandler } from '../middlewares/auth.js';
import { sendSuccess, sendError } from '../lib/response.js'; // sendSuccess, sendError 사용
const router = express.Router();
const logger = createLogger('authRoutes');

// 공통 요청 로깅
router.use((req, res, next) => { logger.debug(`AuthRoutes 요청: ${req.method} ${req.originalUrl}`); next(); });
// OAuth 라우트 설정 로그
logger.debug('OAuth 라우트 설정 완료');

const isDevelopment = () => process.env.NODE_ENV === 'development';
// Always secure cookies for sameSite='none' cross-site scenarios (dev and prod)
const getSecureCookieSetting = () => true;

// 개발환경에 맞는 쿠키 설정
const getCookieOptions = () => {
  if (isDevelopment()) {
    return {
      httpOnly: true,
      secure: true,  // localhost에서도 HTTPS 사용하므로 true
      sameSite: 'lax', // 개발환경에서는 lax 사용
      path: '/',
    };
  } else {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'none', // 프로덕션에서는 none 사용
      path: '/',
    };
  }
};

// 환경에 따른 프론트엔드 URL 설정
const getFrontendUrl = () => {
  const frontendPort = process.env.FRONTEND_PORT || '3000';
  return process.env.NODE_ENV === 'development' 
    ? `https://localhost:${frontendPort}` 
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
    try {
      const result = await authController.checkEmailAndPassword(req);
      if (result.refreshToken) {
        const cookieOptions = getCookieOptions();
        res.cookie('refreshToken', result.refreshToken, cookieOptions);
        res.cookie('token', result.data.accessToken, cookieOptions);
      }
      return sendSuccess(res, { accessToken: result.data.accessToken, user: result.data.user }, result.message);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
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
  passport.authenticate('google', { session: false, failureRedirect: `${getFrontendUrl()}/login?error=google_auth_failed` }, async (err, user, info) => {
    if (err) {
      logger.error('Google OAuth 콜백 에러:', err);
      return sendError(res, 500, 'Google OAuth 처리 중 에러 발생');
    }

    const frontendUrl = getFrontendUrl();
    if (!user) {
      if (info && info.message === 'EMAIL_CONFLICT') {
        const { email, googleId } = info;
        return res.redirect(
          `${frontendUrl}/link-accounts?email=${encodeURIComponent(email)}&googleSub=${encodeURIComponent(googleId)}&provider=google`
        );
      } else {
        return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(info?.message || '구글 로그인 실패')}`);
      }
    }

    if (!user.is_completed) {
      return res.redirect(
        `${frontendUrl}/add-info?email=${encodeURIComponent(user.email)}&provider=google`
      );
    } else {
      try {
        const tokens = await issueTokens(user.id);
        const cookieOptions = getCookieOptions();
        res.cookie('refreshToken', tokens.refreshToken, cookieOptions);
        return res.redirect(
          `${frontendUrl}/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        logger.error('Google OAuth issueTokens 오류:', error);
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
  passport.authenticate("kakao", { session: false, failureRedirect: `${getFrontendUrl()}/login?error=kakao_auth_failed` }, async (err, user, info) => {
    if (err) {
        logger.error('Kakao OAuth 콜백 에러:', err);
        return sendError(res, 500, 'Kakao OAuth 처리 중 에러 발생');
    }
    const frontendUrl = getFrontendUrl();

    if (!user) {
      if (info && info.message === "EMAIL_CONFLICT_LOCAL") {
        const { email, kakaoId } = info;
        return res.redirect(
          `${frontendUrl}/link-accounts?email=${encodeURIComponent(email)}&provider=kakao&providerId=${encodeURIComponent(kakaoId)}&mode=localLink`
        );
      } 
      else if (info && info.message === "EMAIL_IN_USE_SOCIAL") {
        return res.redirect(`${frontendUrl}/login?error=social_email_in_use`);
      } 
      else {
        return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(info?.message || '카카오 로그인 실패')}`);
      }
    }

    if (!user.is_completed) {
      return res.redirect(
        `${frontendUrl}/add-info?email=${encodeURIComponent(user.email)}&provider=kakao`
      );
    } else {
      try {
        const tokens = await issueTokens(user.id);
        const cookieOptions = getCookieOptions();
        res.cookie("refreshToken", tokens.refreshToken, cookieOptions);
        return res.redirect(
          `${frontendUrl}/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        logger.error('Kakao OAuth issueTokens 오류:', error);
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
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    try {
      const result = await authController.signup(req);
      if (result.refreshToken) {
        const cookieOptions = getCookieOptions();
        res.cookie('refreshToken', result.refreshToken, cookieOptions);
      }
      return sendSuccess(res, result.data, result.message);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  })
);
router.post(
  '/verify',
  body('token').notEmpty().withMessage('검증 토큰이 필요합니다.'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    try {
      const result = await authController.verify(req);
      return sendSuccess(res, result.data, result.message);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  })
);
router.post(
  '/check-email',
  body('email').isEmail().withMessage('유효한 이메일이 필요합니다.'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    try {
      const result = await authController.checkEmail(req);
      return sendSuccess(res, result.data);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  })
);
router.post(
  '/check-email-and-password',
  body('email').isEmail().withMessage('유효한 이메일이 필요합니다.'),
  body('password').notEmpty().withMessage('비밀번호가 필요합니다.'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    try {
      const result = await authController.checkEmailAndPassword(req);
      if (result.refreshToken) {
        const cookieOptions = getCookieOptions();
        res.cookie('refreshToken', result.refreshToken, cookieOptions);
      }
      return sendSuccess(res, result.data, result.message);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  })
);
router.post(
  '/link-accounts',
  body('email').isEmail().withMessage('유효한 이메일이 필요합니다.'),
  body('provider').notEmpty().withMessage('provider가 필요합니다.'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    try {
      const result = await authController.linkAccounts(req);
      if (result.refreshToken) {
        const cookieOptions = getCookieOptions();
        res.cookie('refreshToken', result.refreshToken, cookieOptions);
      }
      return sendSuccess(res, result.data, result.message);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  })
);
router.post(
  '/addinfo',
  authenticateJWT,
  body('userInfo').notEmpty().withMessage('추가 정보가 필요합니다.'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, '검증 오류', errors.array());
    try {
      const result = await authController.addInfo(req);
      if (result.refreshToken) {
        const cookieOptions = getCookieOptions();
        res.cookie('refreshToken', result.refreshToken, cookieOptions);
      }
      return sendSuccess(res, result.data, result.message);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  })
);
router.post(
  '/refresh', // authenticateJWT 제거
  asyncHandler(async (req, res, next) => {
    try {
      const result = await authController.refresh(req);
      if (result.data && result.data.refreshToken) {
         const cookieOptions = getCookieOptions();
         res.cookie('refreshToken', result.data.refreshToken, cookieOptions);
      }
      // result.data가 이미 { accessToken, refreshToken } 형태이므로 직접 전달
      return sendSuccess(res, result.data);
    } catch (error) {
      return sendError(res, error.statusCode || 401, error.message); // Refresh 실패는 보통 401
    }
  })
);
// 로그아웃 라우트 (토큰 제거)
router.post(
  '/logout',
  authenticateJWT,
  asyncHandler(async (req, res, next) => {
    try {
      const result = await authController.logout(req);
      if (result.clearCookies) {
        result.clearCookies.forEach(cookie => {
          const cookieOptions = getCookieOptions();
          res.clearCookie(cookie.name, { ...cookieOptions, ...cookie.options });
        });
      }
      if (result.statusCode === 204) {
        return res.status(204).send();
      } 
      return sendSuccess(res, null, result.message, result.statusCode);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  })
);

export default router;
