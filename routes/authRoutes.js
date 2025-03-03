// routes/authRoutes.js
import express from 'express';
import passport from 'passport';
import authController from '../controllers/authController.js'; // 확장자 .js가 필요할 수 있음
const router = express.Router();


// ----- 로컬 로그인 -----
// 'local' 전략으로 인증 (이메일/비번)
router.post('/login', 
    (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      // user가 false → 인증 실패
      return res.status(401).json({ message: info?.message || 'Auth Failed' });
    }
    // 인증 성공 => user 객체 존재
    // 여기서 JWT 발급 후 응답
    const tokens = authController.issueTokens(user.id); // accessToken, refreshToken
    res.json({
      message: '로그인 성공',
      user: { id: user.id, email: user.email },
      ...tokens
    });
  })(req, res, next);
});

// ----- 보호 라우트 예시: /me -----
router.get('/me',
  passport.authenticate('jwt', { session: false }),
  (req, res) => {
    // passport-jwt 전략 성공 시 req.user에 user 객체가 들어감
    const user = req.user;
    res.json({ 
      message: '유저 정보 조회 성공',
      user: { id: user.id, email: user.email } 
    });
  }
);

// ----- 구글 OAuth -----
router.get('/google',
  passport.authenticate('google', { scope: ['email', 'profile'] })
  // 이 단계에서 구글 로그인 페이지로 리다이렉트됨
);

router.get('/google/callback',
    // 1) 커스텀 콜백 방식
    (req, res, next) => {
      passport.authenticate('google', { session: false }, (err, user, info) => {
        if (err) return next(err);
  
        if (!user) {
          // user가 null이면 → 인증 실패
          if (info && info.message === 'EMAIL_CONFLICT') {
            // 구글 이메일이 이미 로컬 가입되어 있는 경우
            const { email, googleId } = info;
            // 이제 /link-accounts 페이지로 리다이렉트하여
            // 로컬 비밀번호 입력받고, 계정 연결
            return res.redirect(
              `http://localhost:3000/link-accounts?email=${encodeURIComponent(
                email
              )}&googleSub=${encodeURIComponent(googleId)}`
            );
          } else {
            // 그 외 일반적인 오류
            return res
              .status(400)
              .json({ message: info?.message || '구글 로그인 실패' });
          }
        }
  
        // user가 있으면 → 구글 인증 성공
        // 여기서 JWT 발급 or /add-info 리다이렉트
        if (!user.is_completed) {
          // 추가정보 필요시
          return res.redirect(
            `https://lakabe.com/add-info?email=${encodeURIComponent(
              user.email
            )}`
          );
        } else {
          // 이미 가입 완료 → 토큰 발급 후 /dashboard
          // (예시) authController.issueTokens
          const tokens = authController.issueTokens(user.id);
          return res.redirect(
            `https://lakabe.com/dashboard?accessToken=${tokens.accessToken}`
          );
        }
      })(req, res, next);
    }
  );

// ----- 카카오 OAuth -----
router.get('/kakao', 
    passport.authenticate('kakao')); 
// 1) /auth/kakao 접속하면 카카오 로그인 페이지로 이동

router.get('/kakao/callback',
  // 2) 커스텀 콜백 방식을 사용 (Google과 유사한 형태)
  (req, res, next) => {
    passport.authenticate('kakao', { session: false }, (err, user, info) => {
      if (err) {
        // passport 전략 내부에서 발생한 에러
        return next(err);
      }

      if (!user) {
        // user가 null이거나 false면 → 인증 실패(혹은 가입 유도)
        // 여기서 info 객체를 통해 상황별 처리를 할 수 있음.
        if (info && info.message === 'EMAIL_CONFLICT') {
          // 예: 카카오 이메일이 이미 로컬 가입된 경우
          const { email, kakaoId } = info;
          // /link-accounts 페이지 등으로 이동 → 계정 연동 로직
          return res.redirect(
            `http://localhost:3000/link-accounts?email=${encodeURIComponent(email)}&kakaoId=${encodeURIComponent(kakaoId)}`
          );
        } else {
          // 그 외 일반적인 오류
          return res
            .status(400)
            .json({ message: info?.message || '카카오 로그인 실패' });
        }
      }

      // 여기까지 왔다면 user가 존재 → 카카오 인증 성공
      // (선택) DB에서 user를 찾거나, 이미 passport strategy에서 생성했을 수도 있음

      if (!user.is_completed) {
        // 추가 정보가 필요한 경우(예: 닉네임, 성별, 지역 등)
        return res.redirect(
          `http://localhost:3000/add-info?email=${encodeURIComponent(user.email)}`
        );
      } else {
        // 이미 가입/연동이 완료된 유저라면 → 토큰 발급 후 리다이렉트
        const tokens = authController.issueTokens(user.id);
        return res.redirect(
          `http://localhost:3000/dashboard?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`
        );
      }
    })(req, res, next);
  }
);

router.post('/send-sms-code', authController.sendSmsCode);


router.post('/check-email', authController.checkEmail);


router.post('/social-addinfo', authController.socialAddInfo);


router.post('/verify-and-signup', authController.verifyAndSignup);


router.get('/protected',
  passport.authenticate('jwt', { session: false }),
  (req, res) => {
    res.json({ user: req.user, message: 'OK, secure route' });
  }
);

export default router;