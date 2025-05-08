import axios from 'axios';
import path from 'path'; 
import { fileURLToPath } from 'url'; 
import { createLogger } from '../lib/logger.js';
import MarketingMessageLog from '../models/MarketingMessageLog.js';
import ContactInfo from '../models/ContactInfo.js';
import CustomerInfo from '../models/CustomerInfo.js'; // CustomerInfo 모델 추가
import { Op } from 'sequelize';
import CustomerContactMap from '../models/CustomerContactMap.js';

const logger = createLogger('KakaoController');

// __dirname 설정 (ESM 환경)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 프론트엔드 이미지 루트 디렉토리 절대 경로 설정
// __dirname은 현재 파일(kakaoController.js)의 디렉토리입니다.
// ../../는 my-backend/controllers/에서 my-backend/로, 다시 프로젝트 루트로 이동합니다.
// 그런 다음 my-frontend/public/images/datas로 경로를 완성합니다.
const FRONTEND_IMAGE_ROOT = path.resolve(__dirname, '../../my-frontend/public/images/datas');
logger.info(`Frontend image root directory: ${FRONTEND_IMAGE_ROOT}`);

// Kakao 친구명 생성 helper
function makeKakaoFriendName(company, person) {
  if (!company && person) return person;
  if (!company) return '';
  if (!person) return company;
  const combined = `${company}-${person}`;
  const maxLen = 20;
  if (combined.length <= maxLen) return combined;
  const cutLen = maxLen - (person.length + 1);
  return `${company.slice(0, cutLen)}-${person}`;
}

export const addFriends = async (req, res) => {
  try {
    const friends = req.body.friends;
    const friendsWithName = friends.map(f => ({
      ...f,
      username: makeKakaoFriendName(f.company_name, f.contact_person)
    }));
    const response = await axios.post('http://localhost:5001/kakao/add-friends', { friends: friendsWithName });
    const resultList = response.data?.results || [];
    // 결과에서 상태별 전화번호 목록 추출
    const successPhones = resultList.filter(r => r.status === 'success').map(r => r.phone);
    const alreadyPhones = resultList.filter(r => r.status === 'already_registered').map(r => r.phone);
    const failPhones = resultList.filter(r => r.status === 'fail' || r.status === 'not_allowed').map(r => r.phone);

    // 전화번호 기준으로 DB 업데이트
    if (successPhones.length > 0) {
      await ContactInfo.update(
        { friend_add_status: 'success' },
        { where: { phone_number: { [Op.in]: successPhones } } }
      );
    }
    if (alreadyPhones.length > 0) {
      await ContactInfo.update(
        { friend_add_status: 'already_registered' },
        { where: { phone_number: { [Op.in]: alreadyPhones } } }
      );
    }
    if (failPhones.length > 0) {
      await ContactInfo.update(
        { friend_add_status: 'fail' },
        { where: { phone_number: { [Op.in]: failPhones } } }
      );
    }
    return res.json({ success: true, results: resultList });
  } catch (e) {
    let errorMsg = e.message;
    if (e.response && e.response.data && e.response.data.detail) {
      errorMsg = e.response.data.detail;
    }
    return res.status(500).json({ success: false, error: errorMsg });
  }
};

export const sendMessages = async (req, res) => {
  try {
    const message_groups = req.body.message_groups;
    // original groups for logging content
    const originalGroups = JSON.parse(JSON.stringify(message_groups)); // Deep copy for logging
    if (!Array.isArray(message_groups)) {
      return res.status(400).json({ success: false, message: 'message_groups 배열이 필요합니다.' });
    }
    // image type content 배열 분리 및 절대 경로 변환
    const flattenedGroups = message_groups.map(group => ({
      username: group.username,
      messages: group.messages.flatMap(msg => {
        if (msg.type === 'image') {
          // content가 쉼표로 구분된 상대 경로일 수 있음
          let contentArray = typeof msg.content === 'string'
            ? msg.content.split(',').map(p => p.trim()).filter(p => p)
            : Array.isArray(msg.content)
              ? msg.content
              : [];
          // 절대 경로로 변환
          const absArray = contentArray.map(relativePath => {
            const cleaned = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
            return path.join(FRONTEND_IMAGE_ROOT, cleaned);
          }).filter(p => p.startsWith(FRONTEND_IMAGE_ROOT));
          if (absArray.length === 0) return [];
          // 여러 파일이 있으면 하나의 message로 합침
          return [{ type: 'image', content: absArray.join(',') }];
        }
        // text or other types 그대로 전달
        return [{ type: msg.type, content: msg.content }];
      })
    }));

    // FastAPI에 메시지 전송 (절대 경로가 포함된 그룹 전송)
    logger.info(`Sending flattened groups to FastAPI: ${JSON.stringify(flattenedGroups)}`);
    const response = await axios.post('http://localhost:5001/kakao/send-messages', { message_groups: flattenedGroups });
    const results = response.data.results || [];

    // 마케팅 로그 저장
    const createdLogs = [];
    for (const r of results) {
      const { username, phone, status, reason } = r;
      // 연락처 조회: username에서 contact_person 부분만 사용 (담당자명)
      let contact = null;
      let contactPersonName = '';
      
      if (username && username.includes('-')) {
        // '회사명-담당자명' 형식에서 담당자명 추출
        const parts = username.split('-');
        contactPersonName = parts[parts.length - 1].trim(); // 마지막 부분을 담당자명으로 사용
      } else {
        // '-'가 없으면 전체를 담당자명으로 간주
        contactPersonName = username;
      }
      
      // contact_person으로만 연락처 조회
      if (contactPersonName) {
        contact = await ContactInfo.findOne({ 
          where: { contact_person: contactPersonName },
          include: [{ 
            model: CustomerInfo,
            through: CustomerContactMap
          }]
        });
      }
      
      if (!contact) {
         logger.warn(`Contact not found for contact_person: ${contactPersonName} (username: ${username}). Skipping log.`);
         continue;
      }
      
      // 연결된 고객 정보 확인
      if (!contact.CustomerInfos || contact.CustomerInfos.length === 0) {
        logger.warn(`Contact ${contact.id} (${contactPersonName})에 연결된 CustomerInfo 없음, 로그 생성 건너뜀.`);
        continue;
      }
      
      const customer = contact.CustomerInfos[0]; // 첫 번째 연결된 고객 정보 사용
      const customer_id = customer.id;
      
      // 메시지 내용 추출: originalGroups에서 해당 username의 messages 합치기
      // 이미지 경로는 원래 상대 경로로 로그에 남기도록 originalGroups 사용
      const originalGroup = originalGroups.find(g => g.username === username);
      const contentString = originalGroup && Array.isArray(originalGroup.messages)
        ? originalGroup.messages.map(m => {
            // 이미지 content가 배열이면 join해서 문자열로 만듦
            if (m.type === 'image' && Array.isArray(m.content)) {
              return `[Image: ${m.content.join(', ')}]`;
            }
            return m.content;
          }).join(' | ') // 메시지 구분자 변경
        : '';
      // 로그 생성
      const logEntry = await MarketingMessageLog.create({
        customer_id: customer_id,
        contact_id: contact.id,
        message_content: contentString || phone || '', // contentString 우선 사용
        status: status === 'success' ? 'success' : 'failed', // 'fail' -> 'failed' 로 수정
        sent_at: new Date(),
        fail_reason: status !== 'success' ? reason : null // 실패 사유 추가
      });
      createdLogs.push(logEntry);
    }
    logger.info(`Marketing logs created: ${createdLogs.length}`);
    return res.json({ success: true, results });
  } catch (error) {
    logger.error('sendMessages 처리 중 오류:', error);
    // 에러 응답에 상세 정보 포함 (개발/디버깅 시 유용)
    const errorMessage = error.response?.data?.detail || error.message;
    // 스택 트레이스 로깅 (선택적으로 활성화)
    // logger.error(error.stack);
    return res.status(500).json({ success: false, message: errorMessage, error: error.stack }); // 스택 정보 포함
  }
};
