//config/passport.js

import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import { Strategy as KakaoStrategy } from 'passport-kakao';
import 'dotenv/config';
import bcrypt from 'bcrypt';

// Google Strategy 설정 로그
console.log('[PASSPORT] Google Strategy 설정 시작');
console.log(`[PASSPORT] Google Client ID: ${process.env.GOOGLE_CLIENT_ID ? '설정됨' : '설정되지 않음'}`);
console.log(`[PASSPORT] Google Callback URL: ${process.env.GOOGLE_CALLBACK_URL || '설정되지 않음'}`);

// 공통 소셜 로그인 핸들러 함수
async function handleSocialLogin(provider, profile, done) {
  const providerId = profile.id;
  let email = null;

  if (provider === 'google') {
    email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
    if (!email) {
      console.error('[PASSPORT] Google 계정에 이메일이 없습니다');
      return done(null, false, { message: '이메일 정보가 필요합니다' });
    }
  } else if (provider === 'kakao') {
    email = profile._json?.kakao_account?.email || null;
  }

  console.log(`[PASSPORT] ${provider} 사용자 인증 시도:`, email || `ID: ${providerId}`);

  try {
    let user = await User.findOne({
      where: { provider, provider_id: providerId },
    });

    if (user) {
      console.log(`[PASSPORT] 기존 ${provider} 사용자 (${email || providerId}) 찾음`);
      return done(null, user);
    }

    if (email) {
      const existingUserByEmail = await User.findOne({ where: { email } });
      if (existingUserByEmail) {
        if (existingUserByEmail.provider === 'local') {
          console.log(`[PASSPORT] ${provider} 로그인 시도: 이메일(${email})이 로컬 계정과 충돌.`);
          return done(null, false, {
            message: provider === 'google' ? 'EMAIL_CONFLICT' : 'EMAIL_CONFLICT_LOCAL',
            ...(provider === 'google' && { googleId: providerId }),
            ...(provider === 'kakao' && { kakaoId: providerId }),
            email,
          });
        } else if (existingUserByEmail.provider !== provider) {
          if (provider === 'kakao') {
            console.log(`[PASSPORT] Kakao 로그인 시도: 이메일(${email})이 다른 소셜 계정(${existingUserByEmail.provider})과 이미 연결되어 있습니다.`);
            return done(null, false, { message: 'EMAIL_IN_USE_SOCIAL' });
          }
        }
      }
    }

    const newUserEmail = (provider === 'kakao' && !email) ? "" : email;
    user = await User.create({
      email: newUserEmail,
      provider,
      provider_id: providerId,
      is_completed: false,
    });
    console.log(`[PASSPORT] 새 ${provider} 사용자 생성됨:`, newUserEmail || `ID: ${providerId}`);
    return done(null, user);

  } catch (err) {
    console.error(`[PASSPORT] ${provider} 전략 처리 중 오류:`, err);
    return done(err, false);
  }
}

// [2] JWT 전략 (토큰 검증)
passport.use(
  new JwtStrategy(
    {
      // Authorization 헤더 또는 token 쿠키에서 토큰 추출
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => {
          const tokenFromCookie = req && req.cookies ? req.cookies.token : null;
          const tokenFromAuthHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
          
          // 개발 환경에서만 상세 로그 출력
          if (process.env.NODE_ENV === 'development' && (tokenFromCookie || tokenFromAuthHeader)) {
            console.log('[JWT] 토큰 추출 시도');
            console.log('[JWT] Cookie token:', tokenFromCookie ? tokenFromCookie.substring(0, 20) + '...' : 'null');
            console.log('[JWT] Auth header token:', tokenFromAuthHeader ? tokenFromAuthHeader.substring(0, 20) + '...' : 'null');
          }
          
          return tokenFromAuthHeader || tokenFromCookie;
        }
      ]),
      secretOrKey: process.env.ACCESS_TOKEN_SECRET, // .env에 저장된 키
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (payload, done) => {
      try {
        console.log('[JWT] 토큰 검증 시도. payload:', { userId: payload.userId, exp: payload.exp });
        // payload = { userId: XXX, iat: ..., exp: ... }
        const user = await User.findByPk(payload.userId);
        if (!user) {
          console.log('[JWT] 사용자를 찾을 수 없음:', payload.userId);
          return done(null, false, { message: '유효하지 않은 토큰' });
        }
        console.log('[JWT] 인증 성공:', user.email);
        // 인증 성공 시 user 반환
        return done(null, user);
      } catch (err) {
        console.log('[JWT] 검증 중 오류:', err.message);
        return done(err, false);
      }
    }
  )
);

// 로컬 전략
passport.use(
  new LocalStrategy(
    {
      usernameField: "email",    // POST body에서 email
      passwordField: "password", // POST body에서 password
      session: false,
    },
    async (email, password, done) => {
      try {
        // 1) email 로 유저 찾기
        const user = await User.findOne({ where: { email } });
        if (!user) {
          // 가입된 유저가 없음
          return done(null, false, { message: "이메일 또는 비밀번호가 잘못되었습니다." });
        }

        // 2) user.password(또는 user.passwordHash)에 해시가 없으면 => 소셜만 가입된 케이스일 수 있음
        if (!user.password) {
          return done(null, false, { message: "이메일 또는 비밀번호가 잘못되었습니다." });
        }

        // 3) bcrypt.compare(평문, 해시)
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
          // 비번 불일치
          return done(null, false, { message: "이메일 또는 비밀번호가 잘못되었습니다." });
        }

        // 4) 모두 통과 => 인증 성공
        return done(null, user); 
      } catch (err) {
        console.error("[LocalStrategy ERROR]", err);
        return done(err);
      }
    }
  )
);

// [3] Google OAuth 2.0 전략
try {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        await handleSocialLogin('google', profile, done);
      }
    )
  );
  console.log('[PASSPORT] Google Strategy 설정 완료');
} catch (error) {
  console.error('[PASSPORT] Google Strategy 설정 실패:', error);
}

// [4] Kakao OAuth 2.0 전략
try {
  passport.use(
    new KakaoStrategy(
      {
        clientID: process.env.KAKAO_CLIENT_ID,
        clientSecret: process.env.KAKAO_SECRET_KEY, // 환경 변수 이름 확인 필요 (보통 KAKAO_CLIENT_SECRET 또는 유사)
        callbackURL: process.env.KAKAO_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        await handleSocialLogin('kakao', profile, done);
      }
    )
  );
  console.log('[PASSPORT] Kakao Strategy 설정 완료'); // Kakao 로그 추가
} catch (error) {
  console.error('[PASSPORT] Kakao Strategy 설정 실패:', error);
}

export default passport;
