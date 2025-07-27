import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { redisClient } from '../config/redisClient.js';

export function createAccessToken(userId) {
  return jwt.sign({ userId }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
}

export function createRefreshToken(userId) {
  return jwt.sign({ userId }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
}

export async function issueTokens(userId) {
  const accessToken = createAccessToken(userId);
  const refreshToken = createRefreshToken(userId);
  await User.saveRefreshToken(userId, refreshToken);
  return { accessToken, refreshToken };
}

export async function refreshTokens(refreshToken) {
  try {
    // 1. Refresh token 검증
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const userId = decoded.userId;

    // 2. DB에서 사용자 및 저장된 refresh token 확인
    const user = await User.findByRefreshToken(refreshToken);
    if (!user) {
      const error = new Error('유효하지 않은 refresh token입니다.');
      error.statusCode = 401;
      throw error;
    }

    // 3. 새로운 토큰들 생성
    const newAccessToken = createAccessToken(userId);
    const newRefreshToken = createRefreshToken(userId);

    // 4. 새로운 refresh token을 DB에 저장
    await User.saveRefreshToken(userId, newRefreshToken);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      const tokenError = new Error('유효하지 않거나 만료된 refresh token입니다.');
      tokenError.statusCode = 401;
      throw tokenError;
    }
    throw error;
  }
}

export async function signupLocal(email, password) {
  // 이메일 중복 체크
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    const error = new Error('이미 가입된 이메일입니다.');
    error.statusCode = 400;
    throw error;
  }

  // 6자리 인증 코드 생성
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Redis에 인증 코드 저장 (10분 유효)
  const redisKey = `verify:${email}`;
  await redisClient.setEx(redisKey, 600, JSON.stringify({
    code: verificationCode,
    password: password, // 인증 완료 후 사용자 생성을 위해 임시 저장
    timestamp: Date.now()
  }));

  // 여기서는 실제 이메일 발송은 하지 않고 콘솔에 출력 (개발용)
  console.log(`[DEBUG] 인증 코드 생성: ${email} -> ${verificationCode}`);
  
  // 임시로 성공 응답 반환 (실제로는 이메일 발송 서비스 연동 필요)
  return { message: '인증 이메일이 발송되었습니다.' };
}

export async function verifyEmailCode(email, code) {
  const redisKey = `verify:${email}`;
  const storedData = await redisClient.get(redisKey);
  
  if (!storedData) {
    const error = new Error('인증 코드가 만료되었거나 존재하지 않습니다.');
    error.statusCode = 400;
    throw error;
  }

  const { code: storedCode, password } = JSON.parse(storedData);
  
  if (code !== storedCode) {
    const error = new Error('인증 코드가 일치하지 않습니다.');
    error.statusCode = 400;
    throw error;
  }

  // 인증 성공 - 사용자 생성
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({
    email,
    password: hashedPassword,
    provider: 'local',
    is_completed: false
  });

  // Redis에서 인증 코드 삭제
  await redisClient.del(redisKey);

  return user;
}

export async function checkEmailAndPassword(email, password) {
  const user = await User.findOne({ where: { email } });
  if (!user) throw new Error('User not found');
  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new Error('Password mismatch');
  return user;
}

export async function logoutUser(userId) {
  // 데이터베이스에서 사용자의 refresh token을 제거
  const user = await User.clearRefreshToken(userId);
  
  if (!user) {
    const error = new Error('사용자를 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  return { message: '로그아웃이 완료되었습니다.' };
}
