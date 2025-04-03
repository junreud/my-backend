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

// [2] JWT 전략 (토큰 검증)
passport.use(
  new JwtStrategy(
    {
      // request의 Header "Authorization: Bearer <token>"에서 토큰 추출
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.ACCESS_TOKEN_SECRET, // .env에 저장된 키
    },
    async (payload, done) => {
      try {
        // payload = { userId: XXX, iat: ..., exp: ... }
        const user = await User.findByPk(payload.userId);
        if (!user) {
          return done(null, false, { message: '유효하지 않은 토큰' });
        }
        // 인증 성공 시 user 반환
        return done(null, user);
      } catch (err) {
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
        console.log('[PASSPORT] Google 사용자 인증 시도:', profile.emails && profile.emails[0] ? profile.emails[0].value : '이메일 없음');
        try {
          const googleId = profile.id;
          const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
          
          if (!email) {
            console.error('[PASSPORT] Google 계정에 이메일이 없습니다');
            return done(null, false, { message: '이메일 정보가 필요합니다' });
          }

          // 1) provider='google', provider_id=googleId 여부
          let user = await User.findOne({
            where: { provider: "google", provider_id: googleId },
          });
          if (!user) {
            // 2) 혹시 로컬로 이미 email 가입이 있는가?
            const existing = await User.findOne({ where: { email, provider: "local" } });
            if (existing) {
              // => 이메일 충돌
              return done(null, false, {
                message: "EMAIL_CONFLICT",
                googleId,
                email,
              });
            } else {
              // (B-2) 완전 새로운 email(=DB에 없음) → 새로운 구글 계정으로 생성
              user = await User.create({
                email,
                provider: 'google',
                provider_id: googleId,
                is_completed: false,
              });
              console.log('[PASSPORT] 새 Google 사용자 생성됨:', email);
            }
          } else {
            console.log('[PASSPORT] 기존 Google 사용자 찾음:', email);
          }

          // (C) 최종적으로 user가 있으면 인증 성공
          return done(null, user);
        } catch (err) {
          console.error('[PASSPORT] Google 전략 오류:', err);
          return done(err, false);
        }
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
        clientSecret: process.env.KAKAO_SECRET_KEY,
        callbackURL: process.env.KAKAO_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const kakaoId = profile.id;
          const email = profile._json?.kakao_account?.email || null;

          // 이미 provider='kakao', provider_id=... 인 유저?
          let user = await User.findOne({
            where: { provider: "kakao", provider_id: kakaoId },
          });
          if (!user) {
            // 소셜유저가 없음. 
            // 1) email이 DB에 있는지?
            if (email) {
              const existingUser = await User.findOne({ where: { email } });
              if (existingUser) {
                // (A) existingUser가 provider='local' => "비번 인증 후 소셜 연동"
                if (existingUser.provider === "local") {
                  return done(null, false, {
                    message: "EMAIL_CONFLICT_LOCAL",
                    email,
                    kakaoId,
                  });
                } else {
                  // (B) existingUser가 'kakao'/'google' => 소셜 vs 소셜 => 가입 불가
                  return done(null, false, {
                    message: "EMAIL_IN_USE_SOCIAL",
                  });
                }
              }
            }
            // 2) 아예 없는 email => 새 user
            user = await User.create({
              email: email || "",
              provider: "kakao",
              provider_id: kakaoId,
              is_completed: false,
            });
          }
          // 이미 (kakao,kakaoId)인 user
          return done(null, user);
        } catch (err) {
          return done(err, false);
        }
      }
    )
  );
} catch (error) {
  console.error('[PASSPORT] Kakao Strategy 설정 실패:', error);
}

export default passport;
