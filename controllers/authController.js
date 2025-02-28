// ESM 버전 (authController.js 등의 파일명 가정)

// 라이브러리 import
import jwt from 'jsonwebtoken';
import 'dotenv/config';


// 로컬 모듈 import (필요시 .js 확장자)
import User from '../models/User.js';
import portoneService from '../services/portoneService.js';

// 예: 추가 유틸 함수가 필요하면 import하거나 직접 정의
// import { computeIdentityNumber } from '../utils/identity.js';

// SMS 인증번호 저장소(메모리)
const smsStore = {};

// JWT AccessToken 생성
function createAccessToken(userId) {
  return jwt.sign({ userId }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
}

// JWT RefreshToken 생성
function createRefreshToken(userId) {
  return jwt.sign({ userId }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
}

/**
 * [1] 토큰 발급 로직 (원래 socialAuthService.js 등에 있던 로직)
 * - DB에 refreshToken 저장까지 처리
 */
export function issueTokens(userId) {
  const accessToken = createAccessToken(userId);
  const refreshToken = createRefreshToken(userId);

  // DB에 refreshToken 저장 (비동기로 처리)
  User.saveRefreshToken(userId, refreshToken).catch(console.error);

  return { accessToken, refreshToken };
}

/**
 * [2] Refresh Token 검증 및 새 Access Token 발급
 */
export async function refresh(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'No refresh token' });
    }

    const user = await User.findByRefreshToken(refreshToken);
    if (!user) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Refresh token expired or invalid' });
    }

    const newAccessToken = createAccessToken(user.id);
    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '서버 에러' });
  }
}

/**
 * [3] 소셜 로그인 후 추가 정보 입력 (예: 구글, 카카오)
 */
export async function socialAddInfo(req, res) {
  try {
    const {
      email,
      name,
      birthday6,
      phone,
      carrier,
      gender,
      foreigner,
      // 약관 동의 여부들...
    } = req.body;

    const user = await User.findOne({
      where: { email, provider: 'google' } // 예: 구글 소셜 가입자 찾기
    });
    if (!user) {
      return res.status(404).json({ message: '해당 소셜 유저를 찾을 수 없음' });
    }

    // 추가정보 업데이트
    user.name = name;
    user.birthday6 = birthday6;
    user.phone = phone;
    user.carrier = carrier;
    user.gender = gender;
    user.foreigner = foreigner;
    user.is_completed = true;
    // user.agreePersonalInfo,
    // user.agreeUniqueID,
    // ... (실제 모델 칼럼에 맞춰 업데이트)

    await user.save();

    return res.json({ message: '소셜 추가정보 등록 완료', user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '서버 오류' });
  }
}

/**
 * [A] SMS 코드 발송 (PortOne 예시)
 * POST /auth/send-sms-code
 */
export async function sendSmsCode(req, res) {
  try {
    const {
      name,
      birth,       // "YYYYMMDD"
      phone,       // "01012345678"
      carrier,     // "SKT", "KT", "LGU", 등
      gender,      // "male" / "female"
      foreigner,   // boolean
    } = req.body;

    if (!name || !birth || !phone || !carrier || !gender) {
      return res.status(400).json({ message: '필수 정보가 누락되었습니다.' });
    }

    // PortOne: 본인인증 객체 생성
    const createPayload = {
      requestedCustomer: {
        name,
        phoneNumber: phone,
        birth,
        gender,
        isForeigner: foreigner,
      },
    };

    const createResult = await portoneService.createIdentityVerification(createPayload);
    const verificationId = createResult.id || createResult.response?.id;
    if (!verificationId) {
      return res.status(500).json({ message: 'PortOne returned invalid data' });
    }

    // SMS 전송 (sendIdentityVerification)
    const sendPayload = {
      storeId: process.env.PORTONE_STORE_ID || '',
      channelKey: process.env.PORTONE_CHANNEL_KEY,
      customer: {
        name,
        phoneNumber: phone,
        // 예: computeIdentityNumber(birth, gender)가 필요하다면 정의/불러오기
        identityNumber: birth.slice(2), // 예시로 임의 처리
        ipAddress: req.ip || '',
      },
      operator: carrier,
      method: 'SMS',
    };

    const sendResult = await portoneService.sendIdentityVerification(verificationId, sendPayload);

    // 발송 정보 임시 저장
    smsStore[phone] = {
      verificationId,
      expire: Date.now() + 1000 * 60 * 5, // 5분 후 만료
    };

    return res.json({
      message: 'SMS 인증 요청 완료',
      verificationId,
      sendResult,
    });
  } catch (error) {
    console.error('sendSmsCode error:', error);
    return res.status(500).json({ message: 'Failed to send SMS code' });
  }
}

/**
 * [B] 회원가입
 * POST /auth/signup
 * - verificationId로 SMS 인증 검증
 */
export async function signup(req, res) {
  try {
    const {
      email,
      password,
      name,
      birthday6,
      phone,
      carrier,
      gender,         // "MALE" / "FEMALE"
      foreigner,
      verificationId, // 문자 인증용
    } = req.body;

    // 1) smsStore에서 phone 기록 조회
    const record = smsStore[phone];
    if (!record) {
      return res.status(400).json({ message: 'No SMS record found' });
    }

    if (Date.now() > record.expire) {
      return res.status(400).json({ message: 'SMS verification expired' });
    }

    if (record.verificationId !== verificationId) {
      return res.status(400).json({ message: 'INVALID_CODE' });
    }

    // gender 변환
    let normalizedGender = null;
    if (gender && typeof gender === 'string') {
      const lower = gender.toLowerCase();
      if (lower === 'male' || lower === 'female') {
        normalizedGender = lower;
      }
    }

    // DB 가입 처리
    const newUser = await User.createUser({
      email,
      password,      // 해싱은 createUser 내부에서 처리
      name,
      phone,
      birthday6,
      carrier,
      foreigner,
      gender: normalizedGender,
      provider: 'local',
      role: 'user',
      is_completed: true,
    });

    return res.json({
      message: '가입 성공',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
      },
    });
  } catch (error) {
    console.error('signup error:', error);
    return res.status(500).json({ message: '서버 오류' });
  }
}

/**
 * [C] 이메일 중복 체크
 * POST /auth/check-email
 */
export async function checkEmail(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: '이메일을 입력하세요.' });
    }

    const available = await User.checkEmailAvailability(email);
    return res.json({ available }); // { available: true/false }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '서버 오류' });
  }
}
