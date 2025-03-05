// routes/authRoutes.js

import express from 'express';
import passport from 'passport';
import authController from '../controllers/authController.js'; // default import
import { issueTokens } from '../controllers/authController.js';

const router = express.Router();


router.post('/login', (req, res, next) => {
  passport.authenticate('local', { session: false }, async (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ message: info?.message || 'Auth Failed' });
    }

    try {
      const tokens = await issueTokens(user.id);
      // (1) 리프레시 토큰 → HttpOnly 쿠키
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: false,  // HTTPS면 true
        sameSite: 'none',
      });

      // (2) 액세스 토큰을 쿼리 파라미터로 붙여서 리다이렉트
      //     소셜 로그인과 똑같이 백엔드에서 "http://localhost:3000/oauth-redirect"로 보냄
      return res.redirect(`http://localhost:3000/oauth-redirect?accessToken=${tokens.accessToken}`);
    } catch (error) {
      console.error('[ERROR] issueTokens:', error);
      return res.status(500).json({ message: '토큰 발급 실패' });
    }
  })(req, res, next);
});

// ----- 구글 OAuth -----
router.get('/google',
  passport.authenticate('google', { scope: ['email', 'profile'] })
);

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, async (err, user, info) => {
    if (err) return next(err);

    // 인증 실패 시
    if (!user) {
      // 이메일 중복 등 특정 케이스라면 프론트로 리다이렉트
      // (예시는 기존 코드 유지)
      if (info && info.message === 'EMAIL_CONFLICT') {
        const { email, googleId } = info;
        return res.redirect(
          `http://localhost:3000/link-accounts?email=${encodeURIComponent(email)}&googleSub=${encodeURIComponent(googleId)}&provider=google`
        );
      } else {
        return res.status(400).json({ message: info?.message || '구글 로그인 실패' });
      }
    }

    // 구글 인증 성공
    if (!user.is_completed) {
      // 추가정보 필요 페이지로
      return res.redirect(
        `http://localhost:3000/add-info?email=${encodeURIComponent(user.email)}&provider=google`
      );
    } else {
      // (1) 가입완료 → 토큰 발급
      try {
        const tokens = await issueTokens(user.id);
        // (2) refreshToken을 쿠키로
        res.cookie('refreshToken', tokens.refreshToken, {
          httpOnly: true,
          secure: false,
          sameSite: 'none',
        });
        // (3) accessToken은 쿼리파람(or 해시)로 넘겨주고, 프론트에서 localStorage에 저장 가능
        return res.redirect(
          `http://localhost:3000/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        console.error('[ERROR] issueTokens:', error);
        return res.redirect('http://localhost:3000/login?error=token_issue');
      }
    }
  })(req, res, next);
});

// ----- 카카오 OAuth -----
router.get('/kakao',
  passport.authenticate('kakao')
);

router.get('/kakao/callback', (req, res, next) => {
  passport.authenticate('kakao', { session: false }, async (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      if (info && info.message === 'EMAIL_CONFLICT') {
        const { email, kakaoId } = info;
        return res.redirect(
          `http://localhost:3000/link-accounts?email=${encodeURIComponent(email)}&kakaoId=${encodeURIComponent(kakaoId)}&provider=kakao`
        );
      } else {
        return res.status(400).json({ message: info?.message || '카카오 로그인 실패' });
      }
    }

    if (!user.is_completed) {
      return res.redirect(
        `http://localhost:3000/add-info?email=${encodeURIComponent(user.email)}&provider=kakao`
      );
    } else {
      try {
        const tokens = await issueTokens(user.id);
        // (1) 리프레시 토큰 → HttpOnly 쿠키
        res.cookie('refreshToken', tokens.refreshToken, {
          httpOnly: true,
          secure: false,
          sameSite: 'none',
        });
        // (2) 액세스토큰은 쿼리파람으로 넘겨주기
        return res.redirect(
          `http://localhost:3000/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        console.error('[ERROR] issueTokens:', error);
        return res.redirect('http://localhost:3000/login?error=token_issue');
      }
    }
  })(req, res, next);
});
// ----- 기타 라우트 예시 -----

router.post('/check-email', authController.checkEmail);
router.post('/social-addinfo', authController.socialAddInfo);

// portone 인증
router.post('/verify-and-signup', authController.verifyAndSignup);
router.post('/send-sms-code', authController.sendSmsCode);

// coolsms 전화번호 인증번호 발송
router.post('/phone/send', authController.sendPhoneAuth);
// 전화번호 인증번호 검증
router.post('/phone/verify', authController.verifyPhoneAuth);


export default router;
