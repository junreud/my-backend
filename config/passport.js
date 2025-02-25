const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const KakaoStrategy = require('passport-kakao').Strategy;

require('dotenv').config(); // env 파일에서 SECRET 키 등을 불러온다고 가정

// [1] 로컬 전략 (이메일, 비밀번호)
passport.use(
  new LocalStrategy(
    // 기본 username, password 필드 명을 email, password로 바꿀 수 있음
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        // User.findByEmailAndProvider('local') 활용
        const user = await User.findByEmailAndProvider(email, 'local');
        if (!user) {
          // done(에러, 사용자, 추가메시지)
          return done(null, false, { message: '해당 이메일을 찾을 수 없음' });
        }

        // 비번 비교
        const isMatch = await User.comparePassword(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: '비밀번호가 일치하지 않음' });
        }

        // 로그인 성공 시 user 반환
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// [2] JWT 전략 (토큰 검증)
passport.use(
  new JwtStrategy(
    {
      // request의 Header "Authorization: Bearer <token>"에서 토큰 추출
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.ACCESS_TOKEN_SECRET
    },
    async (payload, done) => {
      try {
        // payload = { userId: XXX, iat: ..., exp: ... }
        const user = await User.findById(payload.userId);
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

// [3] Google OAuth 2.0 전략
passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const email = profile.emails[0].value;
  
          // (A) 먼저, provider='google' && provider_id=googleId 찾기
          let user = await User.findOne({
            where: { provider: 'google', provider_id: googleId },
          });
  
          if (!user) {
            // (B) 기존에 구글 연동된 사용자가 없다면,
            //     혹시 *다른 provider('local')*로 가입된 동일 email이 있는지 찾기
            const existingLocalUser = await User.findOne({
              where: { email, provider: 'local' },
            });
  
            if (existingLocalUser) {
              // (B-1) 해당 email은 이미 로컬로 가입됨. 비밀번호 입력해 계정 연결해야 함.
              // 여기서는 유저를 새로 생성하지 않고,
              // "이메일 충돌" 신호를 보내서 라우트 콜백에서 처리하도록 함.
              return done(null, false, {
                message: 'EMAIL_CONFLICT',
                googleId,      // 충돌된 구글 ID
                email,         // 충돌된 이메일
              });
            } else {
              // (B-2) 완전 새로운 email(=DB에 없음) → 새로운 구글 계정으로 생성
              user = await User.create({
                email,
                provider: 'google',
                provider_id: googleId,
                is_completed: false,
              });
            }
          }
  
          // (C) 최종적으로 user가 있으면 인증 성공
          return done(null, user);
        } catch (err) {
          return done(err, false);
        }
      }
    )
  );
// [4] Kakao OAuth Strategy
passport.use(
    new KakaoStrategy(
      {
        clientID: process.env.KAKAO_CLIENT_ID,
        callbackURL: process.env.KAKAO_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // profile: 카카오에서 넘겨주는 사용자 정보
          // 대표적으로 profile.id, profile.username, profile._json 등에 세부 정보가 있음
          const kakaoId = profile.id;
  
          // 카카오에서 이메일 정보를 제공받으려면 "개인정보 동의항목"에서 '이메일' 동의가 필요
          // profile._json.kakao_account.email 또는 profile._json.kakao_account.email_needs_agreement 등에 있음
          const email = profile._json?.kakao_account?.email || null;
  
          // 1) DB에서 (provider='kakao', provider_id=kakaoId) 찾기
          let user = await User.findOne({
            where: { provider: 'kakao', provider_id: kakaoId },
          });
  
          // 2) 없으면 새로 생성
          if (!user) {
            // (email이 없을 수도 있으므로, null일 경우 처리 로직 필요할 수 있음)
            user = await User.create({
              email: email || '',  // 이메일 없는 경우 '' 등으로 저장
              provider: 'kakao',
              provider_id: kakaoId,
              is_completed: false, // 소셜 추가정보 페이지로 유도하기 위해 false
            });
          }
  
          // 3) done(null, user) => 인증 성공
          return done(null, user);
        } catch (err) {
          return done(err, false);
        }
      }
    )
  );
  
module.exports = passport;

