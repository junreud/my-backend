// controllers/authController.js (ESM)

import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { redisClient } from '../config/redisClient.js';
import { sendVerificationCode } from '../services/emailService.js';
import bcrypt from 'bcrypt';
import { createLogger } from '../lib/logger.js';
import * as authService from '../services/authService.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';

const logger = createLogger('AuthController');
const { handleDbOperation, validateRequiredFields } = createControllerHelper('AuthController');

// TODO: coolsms 모듈을 사용하여 문자 메시지 전송 마무리
// ------------------------------------------------------------
// 토큰 생성 함수
// ------------------------------------------------------------
function createAccessToken(userId) {
  // 15분 만료 설정
  return jwt.sign({ userId }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
}

function createRefreshToken(userId) {
  // 7일 만료 예시
  return jwt.sign({ userId }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
}

// ------------------------------------------------------------
// [1] Tokens 발급
// ------------------------------------------------------------
export async function issueTokens(userId) {
  const accessToken = createAccessToken(userId);
  const refreshToken = createRefreshToken(userId);

  // DB에 refreshToken 저장
  await User.saveRefreshToken(userId, refreshToken);

  return { accessToken, refreshToken };
}

// ------------------------------------------------------------
// [2] Refresh 요청
// ------------------------------------------------------------
export async function refresh(req) { // res, next 제거
  try {
    const token = req.cookies.refreshToken;
    
    if (!token) {
      const error = new Error('No refresh token');
      error.statusCode = 401;
      throw error;
    }
    
    const tokens = await handleDbOperation(async () => {
      return await authService.refreshTokens(token);
    }, "토큰 갱신");
    
    return { data: tokens }; // 데이터 반환
  } catch (err) {
    // next(err) 대신 에러 throw
    if (!err.statusCode) logger.error('Refresh token error:', err); // 이미 statusCode가 있으면 authService에서 설정된 것
    throw err;
  }
}

// ------------------------------------------------------------
// 환경 설정 헬퍼 함수
// ------------------------------------------------------------
const isDevelopment = () => process.env.NODE_ENV === 'development';
const getSecureCookieSetting = () => !isDevelopment(); // 개발환경이 아닐 때만 secure:true 설정

// ------------------------------------------------------------
// [3] 소셜 로그인 후 추가 정보 입력
// ------------------------------------------------------------
export async function addInfo(req) { // res, next 제거
  try {
    const {
      email,
      name,
      phone,
      birthday8,
      provider,
      agreeMarketingTerm,
    } = req.body;

    logger.debug("[DEBUG] /addinfo, req.body =", req.body);

    const user = await User.findOne({ where: { email, provider } });

    if (!user) {
      const error = new Error("유저가 존재하지 않습니다. (인증 or 임시가입이 안 된 상태)");
      error.statusCode = 404;
      throw error;
    }

    user.name = name;
    user.phone = phone;
    user.birthday8 = birthday8;
    user.agree_marketing_term = agreeMarketingTerm ? 1 : 0;
    user.is_completed = true;

    const randomIndex = Math.floor(Math.random() * 10) + 1;
    user.avatar_url = `/avatars/${randomIndex}.png`;

    await handleDbOperation(async () => user.save(), "사용자 추가 정보 저장");

    const tokens = await issueTokens(user.id);

    // redirectUrl 결정 로직은 라우터 또는 프론트엔드 설정에 따라 달라질 수 있으므로, 여기서는 필요한 정보만 반환
    // const isDev = process.env.NODE_ENV === 'development';
    // const baseUrl = isDev ? 'https://localhost:3000' : (process.env.FRONTEND_URL || 'https://lakabe.com');
    
    return { // 데이터 및 쿠키 설정용 토큰 반환
      data: {
        accessToken: tokens.accessToken,
        // redirectUrl: `${baseUrl}/oauth-redirect?accessToken=${tokens.accessToken}` // 라우터에서 결정
      },
      message: "가입 완료",
      refreshToken: tokens.refreshToken
    };
  } catch (err) {
    logger.error("[ERROR] /addinfo:", err);
    if (!err.statusCode) err.statusCode = 500;
    if (!err.message) err.message = "서버 오류";
    throw err;
  }
}


// ------------------------------------------------------------
// [4] 회원가입 (Local Signup)
// ------------------------------------------------------------
export async function signup(req) { // res, next 제거
  try {
    const { email, password } = req.body;
    const validation = validateRequiredFields(req.body, ['email', 'password']);
    if (validation) {
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }
    const user = await handleDbOperation(async () => {
      return await authService.signupLocal(email, password);
    }, "로컬 회원가입");
    
    const tokens = await issueTokens(user.id);

    return { // 데이터 및 쿠키 설정용 토큰 반환
      data: { user, accessToken: tokens.accessToken },
      message: "회원가입 성공",
      refreshToken: tokens.refreshToken
    };
  } catch (err) {
    logger.error(`Signup error: ${err.message}`, err);
    if (!err.statusCode) err.statusCode = 500; // authService에서 statusCode를 설정했을 수 있음
    throw err;
  }
}

// ------------------------------------------------------------
// [5] 이메일 인증
// ------------------------------------------------------------
export async function verify(req) { // res, next 제거
  try {
    const { email, code } = req.body;
    const validation = validateRequiredFields(req.body, ['email', 'code']);
    if (validation) {
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }
    await handleDbOperation(async () => {
      return await authService.verifyEmailCode(email, code);
    }, "이메일 코드 인증");
    return { data: { verified: true }, message: "이메일 인증 성공" };
  } catch (err) {
    logger.error(`Email verification error: ${err.message}`, err);
    if (!err.statusCode) err.statusCode = 500;
    throw err;
  }
}

// ------------------------------------------------------------
// [6] 이메일 중복 체크
// ------------------------------------------------------------
export async function checkEmail(req) { // res, next 제거
  try {
    const { email } = req.body;
    const validation = validateRequiredFields(req.body, ['email']);
    if (validation) {
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }

    const available = await handleDbOperation(async () => {
      return await User.checkEmailAvailability(email);
    }, "이메일 중복 체크");
    
    return { data: { available } };
  } catch (err) {
    logger.error(`Check email error: ${err.message}`, err);
    if (!err.statusCode) err.statusCode = 500;
    if (!err.message) err.message = '서버 오류';
    throw err;
  }
}
// ------------------------------------------------------------
// [7] 이메일/비밀번호 체크 (로그인 핸들러로 사용 가능)
// ------------------------------------------------------------
export async function checkEmailAndPassword(req) { // res, next 제거
  try {
    const { email, password } = req.body;
    const validation = validateRequiredFields(req.body, ['email', 'password']);
    if (validation) {
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }
    const user = await handleDbOperation(async () => {
      return await authService.checkEmailAndPassword(email, password);
    }, "이메일/비밀번호 확인");

    const tokens = await issueTokens(user.id);
    
    return { // 데이터 및 쿠키 설정용 토큰 반환
      data: { user, accessToken: tokens.accessToken },
      message: '로그인 성공',
      refreshToken: tokens.refreshToken
    };
  } catch (err) {
    logger.error(`Login error: ${err.message}`, err);
    if (!err.statusCode) err.statusCode = 401; // 기본적으로 인증 실패로 처리
    throw err;
  }
}

// ------------------------------------------------------------
// [8] 계정 연동
// ------------------------------------------------------------
export async function linkAccounts(req) { // res, next 제거
  try {
    const { email, provider, providerId } = req.body;
    const validation = validateRequiredFields(req.body, ['email', 'provider', 'providerId']);
    if (validation) {
      const error = new Error(validation.message);
      error.statusCode = 400;
      throw error;
    }

    const user = await handleDbOperation(async () => {
      const u = await User.findOne({ where: { email } });
      if (!u) {
        const notFoundError = new Error('유저 없음');
        notFoundError.statusCode = 404;
        throw notFoundError;
      }
      u.provider = provider;
      u.provider_id = providerId;
      await u.save();
      return u;
    }, "계정 연동");

    // User.findOne에서 못찾으면 위에서 throw 하므로, 이 시점엔 user가 있어야 함.
    // if (!user) {
    //   const error = new Error("유저 없음"); // 이 코드는 도달하지 않아야 함
    //   error.statusCode = 404;
    //   throw error;
    // }

    const tokens = await issueTokens(user.id);

    return { // 데이터 및 쿠키 설정용 토큰 반환
      data: { accessToken: tokens.accessToken },
      message: "연동+로그인 완료",
      refreshToken: tokens.refreshToken
    };
  }
  catch (err) {
    logger.error("[ERROR] /linkAccounts:", err);
    if (!err.statusCode) err.statusCode = 500;
    if (!err.message) err.message = "서버 오류";
    throw err;
  }
}

// ------------------------------------------------------------
// [X] Logout: clear refresh token and cookie
// ------------------------------------------------------------
export async function logout(req) { // res, next 제거
  try {
    if (!req.user || !req.user.id) {
      const error = new Error("사용자 ID를 찾을 수 없습니다.");
      error.statusCode = 400;
      throw error;
    }
    const userId = req.user.id;
    
    await handleDbOperation(async () => {
      return await authService.logoutUser(userId);
    }, "로그아웃");
    
    return { // 쿠키 제거를 위한 정보 반환 (실제 제거는 라우터에서)
      message: "로그아웃 성공",
      statusCode: 204, // No Content
      clearCookies: [{ name: 'refreshToken', options: { httpOnly: true, secure: (process.env.NODE_ENV !== 'development'), sameSite: "none", path: '/' } }]
      // getSecureCookieSetting()이 라우터에 있으므로, 라우터에서 옵션 설정
    };
  } catch (err) {
    logger.error(`Logout error: ${err.message}`, err);
    if (!err.statusCode) err.statusCode = 500;
    if (!err.message) err.message = "로그아웃 실패";
    throw err;
  }
}

// ------------------------------------------------------------
// Export default
// ------------------------------------------------------------
export default {
  refresh,
  addInfo,
  checkEmail,
  issueTokens,
  signup,
  verify,
  checkEmailAndPassword,
  linkAccounts,
  logout
};
