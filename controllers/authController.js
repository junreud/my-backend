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
const { sendSuccess, sendError, handleDbOperation, validateRequiredFields } = createControllerHelper('AuthController');

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
export async function refresh(req, res, next) {
  try {
    const token = req.cookies.refreshToken;
    
    if (!token) {
      return sendError(res, 401, 'No refresh token');
    }
    
    const tokens = await handleDbOperation(async () => {
      return await authService.refreshTokens(token);
    }, "토큰 갱신");
    
    return sendSuccess(res, tokens);
  } catch (err) {
    next(err);
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
export async function addInfo(req, res) {
  try {
    const {
      email,
      name,
      phone,
      birthday8,
      provider, // "local", "kakao", "google" ...
      agreeMarketingTerm,
    } = req.body;

    console.log("[DEBUG] /addinfo, req.body =", req.body);

    // 1) DB에서 user 찾기
    const user = await User.findOne({ where: { email, provider } });

    // 2) 유저가 정말 없으면 => 잘못된 플로우이므로 에러
    if (!user) {
      return res
        .status(404)
        .json({ message: "유저가 존재하지 않습니다. (인증 or 임시가입이 안 된 상태)" });
    }

    // 3) 추가 정보 업데이트
    user.name = name;
    user.phone = phone;
    user.birthday8 = birthday8; // DB 컬럼에 맞게
    user.agree_marketing_term = agreeMarketingTerm ? 1 : 0;
    user.is_completed = true; // 최종 가입 완료!

    // =========== 랜덤 아바타 할당 로직 추가 ============
    // public/avatars/1.png ~ 10.png 중 하나를 무작위 선택
    const randomIndex = Math.floor(Math.random() * 10) + 1; // 1~10
    user.avatar_url = `/avatars/${randomIndex}.png`;
    // ===================================================

    await user.save();

    // 4) 자동 로그인 or 그냥 완료 응답
    //    (A) 토큰 발급
    const tokens = await issueTokens(user.id);

    //    (B) refreshToken -> 쿠키
    res.cookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: getSecureCookieSetting(),
      sameSite: "none",
      path: '/',
    });

    // 환경에 따라 다른 리다이렉트 URL 사용
    const baseUrl = isDevelopment() 
      ? 'https://localhost:3000' 
      : 'https://lakabe.com';
      
    //    (C) accessToken -> JSON
    return res.json({
      message: "가입 완료",
      accessToken: tokens.accessToken,
      redirectUrl: `${baseUrl}/oauth-redirect?accessToken=${tokens.accessToken}`,
    });
  } catch (err) {
    console.error("[ERROR] /addinfo:", err);
    return res.status(500).json({ message: "서버 오류" });
  }
}


// ------------------------------------------------------------
// [4] 회원가입 (Local Signup)
// ------------------------------------------------------------
export async function signup(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    const user = await authService.signupLocal(email, password);
    return res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// [5] 이메일 인증
// ------------------------------------------------------------
export async function verify(req, res, next) {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ message: 'email and code required' });
    await authService.verifyEmailCode(email, code);
    return res.json({ verified: true });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// [6] 이메일 중복 체크
// ------------------------------------------------------------
export async function checkEmail(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: '이메일을 입력하세요.' });
    }

    const available = await User.checkEmailAvailability(email);
    return res.json({ available });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '서버 오류' });
  }
}
// ------------------------------------------------------------
// [7] 이메일/비밀번호 체크
// ------------------------------------------------------------
export async function checkEmailAndPassword(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await authService.checkEmailAndPassword(email, password);
    return res.json({ message: '로그인 성공', user });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// [8] 계정 연동
// ------------------------------------------------------------
export async function linkAccounts(req, res) {
  const { email, provider, providerId } = req.body;
  if (!email || !provider || !providerId) {
    return res
      .status(400)
      .json({ message: "email, provider, providerId가 필요합니다." });
  }

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ message: "유저 없음" });
    }

    user.provider = provider;
    user.provider_id = providerId;
    await user.save();
    // Ensure tokens are awaited properly
    const tokens = await issueTokens(user.id);

    // set-cookie refresh
    res.cookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: getSecureCookieSetting(),
      sameSite: "none",
      path: '/',
    });
    // json 응답으로 accessToken
    return res.json({ message: "연동+로그인 완료", accessToken: tokens.accessToken });
  }
  catch (err) {
    console.error("[ERROR] /linkAccounts:", err);
    return res.status(500).json({ message: "서버 오류" });
  }
}

// ------------------------------------------------------------
// [X] Logout: clear refresh token and cookie
// ------------------------------------------------------------
export async function logout(req, res, next) {
  try {
    const userId = req.user.id;
    await authService.logoutUser(userId);
    res.clearCookie('refreshToken');
    return res.sendStatus(204);
  } catch (err) {
    next(err);
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
