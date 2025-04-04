// controllers/authController.js (ESM)

import jwt from 'jsonwebtoken';
import 'dotenv/config'; // for process.env
import User from '../models/User.js';
import { redisClient } from '../config/redisClient.js';
import { sendVerificationCode } from '../services/emailService.js';
import bcrypt from 'bcrypt';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('AuthController');

// TODO: coolsms 모듈을 사용하여 문자 메시지 전송 마무리
// ------------------------------------------------------------
// 토큰 생성 함수
// ------------------------------------------------------------
function createAccessToken(userId) {
  // 15분 만료 예시
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
export async function refresh(req, res) {
  try {
    // 쿠키에서 리프레시 토큰 추출
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(400).json({ message: 'No refresh token' });
    }

    const user = await User.findByRefreshToken(refreshToken);
    if (!user) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    // 토큰 유효성 검사
    try {
      jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Refresh token expired or invalid' });
    }

    // Access Token 재발급
    const newAccessToken = createAccessToken(user.id);
    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '서버 에러' });
  }
}

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
      secure: true, // HTTPS 사용 시 true로 설정
      sameSite: "none",
    });

    // 환경에 따라 다른 리다이렉트 URL 사용
    const baseUrl = process.env.NODE_ENV === 'development' 
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
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: '이메일이 필요합니다.' });
  }

  try {
    // 1) 이미 가입된 이메일인지 확인 (선택)
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: '이미 가입된 이메일입니다.' });
    }

    // 2) 인증코드 생성 & Redis 저장 (5분)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await redisClient.setEx(`verifyCode:${email}`, 300, code);

    // 3) 이메일 발송
    await sendVerificationCode(email, code);

    return res.json({
      message: '인증코드가 이메일로 발송되었습니다.',
      note: '인증코드 검증은 /verify에서 진행',
    });
  } catch (err) {
    console.error('[SIGNUP ERROR]', err);
    return res.status(500).json({ message: '서버 에러, 인증코드 발송 실패' });
  }
}

// ------------------------------------------------------------
// [5] 이메일 인증
// ------------------------------------------------------------
export async function verify(req, res) {
  const { email, code, password } = req.body; // password도 함께 받아야 함(로컬 가입 시)

  // 1) Redis
  const storedCode = await redisClient.get(`verifyCode:${email}`);
  if (!storedCode) {
    return res.status(400).json({ message: '인증코드가 만료되었거나 없음' });
  }
  if (storedCode !== code) {
    return res.status(400).json({ message: '인증코드가 일치하지 않습니다.' });
  }

  // 2) 인증 성공 -> code 삭제
  await redisClient.del(`verifyCode:${email}`);

  // 3) DB user 생성 or 찾기
  let user = await User.findOne({ where: { email, provider: 'local' } });
  if (!user) {
    // 비번 해싱
    const hashedPw = await bcrypt.hash(password, 10);
    user = await User.create({
      email,
      password: hashedPw,
      provider: 'local',
      is_completed: false,  // add-info 단계 전
    });
  }
  return res.json({
    message: '인증 성공! 이제 /add-info 단계로 가세요.',
    verified: true,
  });
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
export async function checkEmailAndPassword(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "이메일/비밀번호가 필요합니다." });
  }
  
  // 1) DB에서 user 찾기
  const user = await User.findOne({ where: { email } });
  if (!user) {
    return res.status(404).json({ message: "가입되지 않은 이메일" });
  }

  // 2) 비번 비교
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ message: "비밀번호가 일치하지 않습니다." });
  }

  // 3) 성공
  return res.json({ message: "로그인 성공", user });
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
    const tokens = await issueTokens(user.id); // Ensure tokens are awaited properly

    // set-cookie refresh
    res.cookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      sameSite: "none",
      secure: process.env.NODE_ENV === 'development', // 개발환경에서만 secure:true 필요
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
};
