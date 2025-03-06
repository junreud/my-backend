// routes/authRoutes.js

import express from 'express';
import passport from 'passport';
import authController from '../controllers/authController.js'; // default import
import { issueTokens } from '../controllers/authController.js';
import { sendVerificationCode } from '../services/emailService.js';
import { redisClient } from '../config/redisClient.js';

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


// 1) 회원가입 시도 -> 이메일로 인증코드 발송
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: '이메일/비밀번호가 필요합니다.' });
  }

  // (비밀번호 검증/중복체크 등은 생략)

  // 6자리 인증코드 생성
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  // TTL(초 단위), 예: 5분 -> 300초
  const ttlSeconds = 300;

  try {
    // 1) Redis에 code 저장: key 예시: "verifyCode:이메일"
    //    'EX' 300 => 300초 뒤 자동 만료
    await redisClient.setEx(`verifyCode:${email}`, ttlSeconds, code);

    // 2) AWS SES로 이메일 발송
    await sendVerificationCode(email, code);

    return res.json({ message: '인증코드가 이메일로 발송되었습니다.' });
  } catch (err) {
    console.error('Redis/Email Error:', err);
    return res.status(500).json({ message: '서버 에러, 인증코드 발송 실패' });
  }
});

// 2) 인증코드 검증
router.post('/verify', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ message: '이메일/인증코드가 필요합니다.' });
  }

  try {
    // Redis에서 저장된 코드 조회
    const storedCode = await redisClient.get(`verifyCode:${email}`);
    if (!storedCode) {
      return res.status(400).json({ message: '인증코드가 만료되었거나 발급되지 않았습니다.' });
    }

    // 코드가 일치하는지 확인
    if (storedCode !== code) {
      return res.status(400).json({ message: '인증코드가 일치하지 않습니다.' });
    }

    // 여기까지 오면 인증 성공
    // DB에 사용자 정보 저장(회원가입 완료) 등을 진행할 수 있음
    // 인증코드 사용 후 삭제(1회용)
    await redisClient.del(`verifyCode:${email}`);

    return res.json({ message: '인증 성공!', redirectUrl: '/add-info' });
  } catch (err) {
    console.error('Redis GET Error:', err);
    return res.status(500).json({ message: '서버 에러' });
  }
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
