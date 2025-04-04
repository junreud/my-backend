// routes/authRoutes.js

import express from 'express';
import passport from 'passport';
import authController from '../controllers/authController.js'; // default import
import { issueTokens } from '../controllers/authController.js';
import { createLogger } from '../lib/logger.js';
import 'dotenv/config';

const logger = createLogger('AuthRoutes');

// 환경에 따른 프론트엔드 URL 설정
const getFrontendUrl = () => {
  return process.env.NODE_ENV === 'development' 
    ? 'https://localhost:3000' 
    : process.env.FRONTEND_URL || 'https://lakabe.com';
};

// 라우트 등록 디버그 로그
console.log('[AUTH_ROUTES] 인증 라우트 등록 시작');

const router = express.Router();

router.post('/login', (req, res, next) => {
  console.log('[AUTH] /login 요청 수신');
  passport.authenticate('local', { session: false }, async (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      // 인증 실패
      return res.status(401).json({ message: info?.message || 'Auth Failed' });
    }

    try {
      // 토큰 발급
      const tokens = await issueTokens(user.id);

      // (1) RefreshToken -> HttpOnly 쿠키
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'development', // 개발 환경에서만 secure:true
        sameSite: 'none',
      });

      // (2) AccessToken -> JSON 응답
      return res.json({
        message: '로그인 성공!',
        accessToken: tokens.accessToken
      });
    } catch (error) {
      console.error('[ERROR] issueTokens:', error);
      return res.status(500).json({ message: '토큰 발급 실패' });
    }
  })(req, res, next);
});

// ----- 구글 OAuth -----
console.log('[AUTH_ROUTES] Google OAuth 라우트 설정');
router.get('/google', (req, res, next) => {
  console.log('[AUTH] Google OAuth 인증 요청 시작');
  passport.authenticate('google', { 
    scope: ['email', 'profile'] 
  })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  console.log('[AUTH] Google OAuth 콜백 요청 수신');
  passport.authenticate('google', { session: false }, async (err, user, info) => {
    if (err) {
      console.error('[AUTH] Google 콜백 에러:', err);
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
        return res.status(400).json({ message: info?.message || '구글 로그인 실패' });
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
          secure: process.env.NODE_ENV === 'development',
          sameSite: 'none',
        });
        
        // (3) accessToken은 쿼리파람으로 넘겨주고, 프론트에서 localStorage에 저장 가능
        const frontendUrl = getFrontendUrl();
        return res.redirect(
          `${frontendUrl}/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        console.error('[ERROR] issueTokens:', error);
        const frontendUrl = getFrontendUrl();
        return res.redirect(`${frontendUrl}/login?error=token_issue`);
      }
    }
  })(req, res, next);
});

// ----- 카카오 OAuth -----
console.log('[AUTH_ROUTES] Kakao OAuth 라우트 설정');
router.get('/kakao', (req, res, next) => {
  console.log('[AUTH] Kakao OAuth 인증 요청 시작');
  passport.authenticate('kakao')(req, res, next);
});

router.get("/kakao/callback", (req, res, next) => {
  console.log('[AUTH] Kakao OAuth 콜백 요청 수신');
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
        return res
          .status(400)
          .json({ message: "이미 소셜로 가입된 이메일 - 가입 불가" });
      } 
      else {
        return res.status(400).json({
          message: info?.message || "카카오 로그인 실패",
        });
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
          secure: process.env.NODE_ENV === 'development',
          sameSite: "none",
        });
        const frontendUrl = getFrontendUrl();
        return res.redirect(
          `${frontendUrl}/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        console.error("[ERROR] issueTokens:", error);
        const frontendUrl = getFrontendUrl();
        return res.redirect(`${frontendUrl}/login?error=token_issue`);
      }
    }
  })(req, res, next);
});

// 기타 라우트들
router.post('/signup', authController.signup);
router.post('/verify', authController.verify);
router.post('/check-email', authController.checkEmail);
router.post('/checkEmailAndPassword', authController.checkEmailAndPassword);
router.post("/link-accounts", authController.linkAccounts);
router.post('/addinfo', authController.addInfo);
router.post('/refresh', authController.refresh);

console.log('[AUTH_ROUTES] 인증 라우트 등록 완료');

export default router;
