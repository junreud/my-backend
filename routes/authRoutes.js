// routes/authRoutes.js

import express from 'express';
import passport from 'passport';
import authController from '../controllers/authController.js'; // default import
import { issueTokens } from '../controllers/authController.js';

//TODO : https 변경 시 secure: true로 변경
const router = express.Router();


router.post('/login', (req, res, next) => {
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
        secure: true, // HTTPS면 true
        sameSite: 'none',
      });

      // (2) AccessToken -> JSON 응답
      //     클라이언트 XHR에서 이걸 받아 localStorage 등에 저장 가능
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
          `https://localhost:3000/link-accounts?email=${encodeURIComponent(email)}&googleSub=${encodeURIComponent(googleId)}&provider=google`
        );
      } else {
        return res.status(400).json({ message: info?.message || '구글 로그인 실패' });
      }
    }

    // 구글 인증 성공
    if (!user.is_completed) {
      // 추가정보 필요 페이지로
      return res.redirect(
        `https://localhost:3000/add-info?email=${encodeURIComponent(user.email)}&provider=google`
      );
    } else {
      // (1) 가입완료 → 토큰 발급
      try {
        const tokens = await issueTokens(user.id);
        // (2) refreshToken을 쿠키로
        res.cookie('refreshToken', tokens.refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: 'none',
        });
        // (3) accessToken은 쿼리파람(or 해시)로 넘겨주고, 프론트에서 localStorage에 저장 가능
        return res.redirect(
          `https://localhost:3000/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        console.error('[ERROR] issueTokens:', error);
        return res.redirect('https://localhost:3000/login?error=token_issue');
      }
    }
  })(req, res, next);
});

// ----- 카카오 OAuth -----
router.get('/kakao',
  passport.authenticate('kakao')
);

router.get("/kakao/callback", (req, res, next) => {
  passport.authenticate("kakao", { session: false }, async (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      // message: EMAIL_CONFLICT_LOCAL => 로컬 계정과 충돌
      if (info && info.message === "EMAIL_CONFLICT_LOCAL") {
        const { email, kakaoId } = info;
        // 프론트 /link-accounts 로 보내고? 
        // 모드=localLink & provider=kakao & providerId=kakaoId
        return res.redirect(
          `https://localhost:3000/link-accounts?email=${encodeURIComponent(
            email
          )}&provider=kakao&providerId=${encodeURIComponent(kakaoId)}&mode=localLink`
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
      return res.redirect(
        `https://localhost:3000/add-info?email=${encodeURIComponent(user.email)}&provider=kakao`
      );
    } else {
      try {
        const tokens = await issueTokens(user.id);
        res.cookie("refreshToken", tokens.refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
        });
        return res.redirect(
          `https://localhost:3000/oauth-redirect?accessToken=${tokens.accessToken}`
        );
      } catch (error) {
        console.error("[ERROR] issueTokens:", error);
        return res.redirect("https://localhost:3000/login?error=token_issue");
      }
    }
  })(req, res, next);
});



// /auth/signup => 이메일/비밀번호로 임시 가입 + 인증코드 발송
router.post('/signup', authController.signup);
// /auth/verify => 인증코드 검증
router.post('/verify', authController.verify);
// ----- 기타 라우트 예시 -----
router.post('/check-email', authController.checkEmail);
router.post('/checkEmailAndPassword', authController.checkEmailAndPassword);
router.post("/link-accounts", authController.linkAccounts);
router.post('/addinfo', authController.addInfo);
router.post('/refresh', authController.refresh);

export default router;
