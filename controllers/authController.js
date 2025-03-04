// controllers/authController.js (ESM)

import jwt from 'jsonwebtoken';
import 'dotenv/config'; // for process.env
import User from '../models/User.js';
import { createIdentityVerification } from '../services/portoneService.js';

// SMS 인증용 저장(예시) 
const smsStore = {};

/**
 * expandBirth6to8
 *   - "YYMMDD" 형태의 6글자를 "YYYYMMDD"로 변환
 */
function expandBirth6to8(shortBirth) {
  if (!shortBirth || shortBirth.length !== 6) {
    throw new Error('Invalid 6글자 생년월일 형식(YYMMDD)이어야 합니다.');
  }

  const YY = parseInt(shortBirth.slice(0, 2), 10);
  const MMDD = shortBirth.slice(2); // "MMDD"

  if (YY >= 35) {
    // 예) 98xxxxx → 1998xxxx
    return '19' + shortBirth;
  } else if (YY <= 25) {
    // 예) 03xxxxx → 2003xxxx
    return '20' + shortBirth;
  } else {
    // 26~34 정도라면? (비즈니스 요구사항에 맞춰 결정)
    // 여기서는 일단 19로 처리
    return '19' + shortBirth;
  }
}

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
    const { refreshToken } = req.body;
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
export async function socialAddInfo(req, res) {
  try {
    // 1) 필요한 필드를 구조 분해 할당
    //    (만약 birthday6를 소셜 추가정보에서도 받는다 치면, 아래처럼 추가)
    const {
      email,
      name,
      phone,
      operator,
      gender,
      foreigner,
      birthday6,
      provider,
      agreeMarketingTerm,       // 소셜 가입 시에도 6자리로 받는 경우
    } = req.body;

    console.log('[DEBUG] socialAddInfo - req.body =', req.body);

    // 2) DB에서 해당 소셜 유저 찾기
    const user = await User.findOne({
      where: { email, provider },
    });
    if (!user) {
      return res.status(404).json({ message: '해당 소셜 유저를 찾을 수 없음' });
    }

    // 3) 생년월일 변환
    //    (실제로 6자리를 받아서 변환하고 싶으면 아래와 같이 사용)
    let dateOfBirth = user.date_of_birth; // 기존 값
    if (birthday6) {
      dateOfBirth = expandBirth6to8(birthday6);
    }

    // 4) 업데이트
    user.name = name;
    user.date_of_birth = dateOfBirth; // DB 컬럼은 date_of_birth
    user.phone = phone;
    user.carrier = operator;
    user.gender = gender;
    user.foreigner = foreigner;
    user.is_completed = true;
    user.agreeMarketingTerm = 1;
    await user.save();

    return res.json({ message: '소셜 추가정보 등록 완료', user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '서버 오류' });
  }
}

// ------------------------------------------------------------
// [A] SMS 코드 발송 (PortOne 본인인증 예시)
// ------------------------------------------------------------
export async function sendSmsCode(req, res) {
  try {
    // 이 부분에서 birthday6(YYMMDD)로 받는다면 필드 이름을 맞춰주세요.
    // 또한 아래 로직과 맞추기 위해서는 'birth' 대신 'birthday6'를 쓰든지,
    // 혹은 expandBirth6to8 -> 'birth' 변환을 하든지 통일이 필요.
    const {
      name,
      birthday6,   // "YYMMDD"
      phone,
      operator,
      gender,      // "male" / "female"
      foreigner,   // boolean
    } = req.body;

    // 유효성 검사
    if (!name || !birthday6 || !phone || !operator || !gender) {
      return res.status(400).json({ message: '필수 정보가 누락되었습니다.' });
    }

    // (1) PortOne: 본인인증 객체 생성
    //    실제로 PortOne에서 요구하는 birth 형식이 "YYYYMMDD"라면,
    //    아래처럼 6자리를 8자리로 변환해 준다.
    const expandedBirth = expandBirth6to8(birthday6);

    const createPayload = {
      requestedCustomer: {
        name,
        phoneNumber: phone,
        birth: expandedBirth, // PortOne에서 필요한 필드명
        gender,
        isForeigner: foreigner,
      },
    };

    // 실제로 아래 함수는 본인인증 API를 호출하는 로직이라고 가정
    const createResult = await createIdentityVerification(createPayload);
    const verificationId = createResult.id || createResult.response?.id;
    if (!verificationId) {
      return res.status(500).json({ message: 'PortOne returned invalid data' });
    }

    // (2) SMS 전송 (sendIdentityVerification)
    const sendPayload = {
      storeId: process.env.PORTONE_STORE_ID || '',
      channelKey: process.env.PORTONE_CHANNEL_KEY,
      customer: {
        name,
        phoneNumber: phone,
        identityNumber: expandedBirth.slice(2), // 예: "980907" 처럼 YYMMDD만 쓰는 경우
        ipAddress: req.ip || '',
      },
      operator,
      method: 'SMS',
    };

    const sendResult = await sendIdentityVerification(verificationId, sendPayload);

    // (3) 발송 정보 임시 저장
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

// ------------------------------------------------------------
// [5] 회원가입 (Local Signup)
// ------------------------------------------------------------
export async function verifyAndSignup(req, res) {
  try {
    const {
      email,
      password,
      name,
      birthday6,    // 6글자 ex) "980907"
      phone,
      operator,
      gender,
      foreigner,
      verificationId,
    } = req.body;

    // 1) 문자 인증 로직
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

    // 2) gender 정규화
    let normalizedGender = null;
    if (gender && typeof gender === 'string') {
      const lower = gender.toLowerCase();
      if (lower === 'MALE' || lower === 'FEMALE') {
        normalizedGender = lower;
      }
    }

    // 3) 6글자 -> 8글자로 변환
    const date_of_birth = expandBirth6to8(birthday6);

    // 4) DB 가입
    const newUser = await User.createUser({
      email,
      password,
      name,
      date_of_birth,   // DB 컬럼명은 date_of_birth
      phone,
      carrier: operator,
      gender: normalizedGender,
      foreigner,
      provider: 'local',
      provider_id: null,
      role: 'user',
      is_completed: true,

    });

    return res.json({
      message: '가입 성공',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        date_of_birth: newUser.date_of_birth,
      },
    });
  } catch (error) {
    console.error('signup error:', error);
    return res.status(500).json({ message: '서버 오류' });
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
// Export default
// ------------------------------------------------------------
export default {
  refresh,
  socialAddInfo,
  sendSmsCode,
  verifyAndSignup,
  checkEmail,
};
