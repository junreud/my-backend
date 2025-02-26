const jwt = require('jsonwebtoken');
const User = require('../models/User');
require('dotenv').config();
const portoneService = require('../services/portoneService');

const smsStore = {}; // 휴대폰 인증번호 저장소

// 토큰 발급 로직 (원래 socialAuthService.js 등에 있던 로직)
function createAccessToken(userId) {
  return jwt.sign({ userId }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
}

function createRefreshToken(userId) {
  return jwt.sign({ userId }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
}

// 토큰 발급 후 DB 저장(갱신)
exports.issueTokens = (userId) => {
  const accessToken = createAccessToken(userId);
  const refreshToken = createRefreshToken(userId);

  // DB에 refreshToken 저장 (async로 처리)
  User.saveRefreshToken(userId, refreshToken).catch(console.error);

  return { accessToken, refreshToken };
};

// 리프레시 토큰 로직도 동일하게 진행
exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'No refresh token' });

    const user = await User.findByRefreshToken(refreshToken);
    if (!user) return res.status(401).json({ message: 'Invalid refresh token' });

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
};

exports.socialAddInfo = async (req, res) => {
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

    // 예: DB의 users 테이블에 업데이트
    // 소셜 가입 시 is_completed=false로 만들었을 테니, 여기서 true로 변경
    const user = await User.findOne({
      where: { email, provider: 'google' } // 혹은 'kakao' 등
    });
    if (!user) {
      return res.status(404).json({ message: '해당 소셜 유저를 찾을 수 없음' });
    }

    // 이제 user의 추가정보 업데이트
    user.name = name;            // 본명
    user.birthday6 = birthday6;  // 생년월일 앞 6자리
    user.phone = phone;          // 
    user.carrier = carrier;      // 통신사
    user.gender = gender;        // 남/녀 중 택1
    user.foreigner = foreigner;  // 외국인/내국인 중 택1
    user.is_completed = true;    // 회원가입 완료
    user.agreePersonalInfo,      // 개인정보 수집 및 이용 동의
    user.agreeUniqueID,         // 개인식별정보
    user.agreeTelecom,          // 통신사 이용약관
    user.agreeCertService,      // 본인인증 서비스 이용약관
    user.agreePrivacy,          // 개인정보 처리방침
    user.agreeMarketing,        // 마케팅 정보 수신 동의
    user.agreeThirdParty,       // 개인정보 제3자 제공 동의
    await user.save();

    return res.json({ message: '소셜 추가정보 등록 완료', user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '서버 오류' });
  }
};

/**
 * [A] SMS 코드 발송
 * POST /auth/send-sms-code
 */
// POST /auth/send-sms-code
exports.sendSmsCode = async (req, res) => {
  try {
    // 1) 프론트에서 전달된 데이터 추출
    const {
      name,
      birth,       // "YYYYMMDD" 형식
      phone,       // "01012345678"
      carrier,     // "SKT", "KT", "LGU", 등
      gender,      // "male" 또는 "female"
      foreigner,   // boolean
    } = req.body;

    // 필수 정보 검증
    if (!name || !birth || !phone || !carrier || !gender) {
      return res.status(400).json({ message: "필수 정보가 누락되었습니다." });
    }

    // 2) 본인인증 객체 생성용 payload 구성 (createIdentityVerification)
    const createPayload = {
      requestedCustomer: {
        name,
        phoneNumber: phone,
        birth,         // "YYYYMMDD"
        gender,        // "male" 또는 "female"
        isForeigner: foreigner,
      },
      // 필요에 따라 storeId나 customData를 추가할 수 있음
    };

    // 3) PortOne에 본인인증 객체 생성 요청
    const createResult = await portoneService.createIdentityVerification(createPayload);
    // 응답 구조에 따라 id가 최상위에 있거나 response 객체 내에 있음
    const verificationId = createResult.id || createResult.response?.id;
    if (!verificationId) {
      return res.status(500).json({ message: "PortOne returned invalid data" });
    }

    // 4) SMS 전송용 payload 구성 (sendIdentityVerification)
    const sendPayload = {
      storeId: process.env.PORTONE_STORE_ID || "", // 선택: 상점 ID (.env에 저장)
      channelKey: process.env.PORTONE_CHANNEL_KEY,   // 필수: 채널키 (.env에 저장)
      customer: {
        name,
        phoneNumber: phone,
        identityNumber: computeIdentityNumber(birth, gender), // 예: "9001011"
        ipAddress: req.ip || "", // Express에서 제공하는 클라이언트 IP (trust proxy 설정 필요할 수 있음)
      },
      operator: carrier,  // 필수: 통신사 ("SKT", "KT", "LGU", 등)
      method: "SMS",      // 필수: 인증 방식
      // 선택: customData, bypass 등 추가 파라미터
    };

    // 5) PortOne에 SMS 인증 요청 전송
    const sendResult = await portoneService.sendIdentityVerification(verificationId, sendPayload);

    // 6) 임시 저장 (예: 인증ID와 만료시간 저장)
    smsStore[phone] = {
      verificationId,
      expire: Date.now() + 1000 * 60 * 5, // 5분 후 만료
    };

    // 7) 프론트엔드에 응답 전달
    return res.json({
      message: "SMS 인증 요청 완료",
      verificationId,
      sendResult,
    });
  } catch (error) {
    console.error("sendSmsCode error:", error);
    return res.status(500).json({ message: "Failed to send SMS code" });
  }
};

/**
 * [B] 회원가입
 * POST /auth/signup
 * (여기서는 "인증번호 검증" 대신 "verificationId"로 인증 결과를 체크한다고 가정)
 */
exports.signup = async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      birthday6,
      phone,
      carrier,          // 현재 User 모델에 없음
      gender,           // "MALE" | "FEMALE"로 올 수 있음 → 모델은 enum('male','female')
      foreigner,        // 현재 User 모델에 없음 (boolean?)
      verificationId,   // 문자 인증용
      // 이하 약관 관련 필드는 모델에 없으므로, DB 저장하려면 모델 칼럼 추가 필요
      // agreePersonalInfo, agreeUniqueID, etc...
    } = req.body;

    // (1) smsStore에서 phone에 해당하는 기록 찾기
    const record = smsStore[phone];
    if (!record) {
      return res.status(400).json({ message: 'No SMS record found' });
    }

    // 만료 체크
    if (Date.now() > record.expire) {
      return res.status(400).json({ message: 'SMS verification expired' });
    }

    // verificationId가 일치하는지 확인
    if (record.verificationId !== verificationId) {
      return res.status(400).json({ message: 'INVALID_CODE' });
    }

    // (2) birthday6 → date_of_birth 변환
    const dateOfBirth = convertBirthday6ToDate(birthday6);

    // (3) gender 변환: "MALE" → "male", "FEMALE" → "female"
    let normalizedGender = null;
    if (gender && typeof gender === 'string') {
      const lower = gender.toLowerCase();
      if (lower === 'male' || lower === 'female') {
        normalizedGender = lower;
      }
    }

    // (4) 실제 DB 가입 처리 (User.createUser 메서드 사용)
    //     password 해싱, email unique 등은 createUser 내부에서 처리됨
    const newUser = await User.createUser({
      email,
      password,         // createUser 안에서 bcrypt.hash 처리
      name,
      phone,
      date_of_birth: dateOfBirth,  
      gender: normalizedGender,    // 'male' or 'female'
      provider: 'local',
      role: 'user',
      is_completed: false, 
    });

    // (5) smsStore에서 삭제 (인증 과정을 1회용으로 처리)
    delete smsStore[phone];

    // (6) 응답
    return res.json({
      message: '가입 성공',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        // 필요 시 phone, date_of_birth, gender 등 추가
      },
    });
  } catch (error) {
    console.error('signup error:', error);
    return res.status(500).json({ message: '서버 오류' });
  }
};
exports.checkEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: '이메일을 입력하세요.' });
    }

    const available = await User.checkEmailAvailability(email);
    return res.json({ available }); 
    // { available: true/false }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '서버 오류' });
  }
};