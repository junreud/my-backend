import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../lib/logger.js';
import MarketingMessageLog from '../models/MarketingMessageLog.js';
import ContactInfo from '../models/ContactInfo.js';
import CustomerInfo from '../models/CustomerInfo.js'; // CustomerInfo 모델 추가
import { Op } from 'sequelize';
import CustomerContactMap from '../models/CustomerContactMap.js';
import { createControllerHelper } from '../utils/controllerHelpers.js'; // Changed to named import

const logger = createLogger('KakaoController');

// __dirname 설정 (ESM 환경)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 프론트엔드 이미지 루트 디렉토리 절대 경로 설정
const FRONTEND_IMAGE_ROOT = path.resolve(__dirname, '../../my-frontend/public/images/datas');
// logger.info(`Frontend image root directory: ${FRONTEND_IMAGE_ROOT}`); // Logging done by helper now

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

export const addFriends = async (req) => { // Removed res
  const { handleDbOperation, logger: controllerLogger, validateRequiredFields } = createControllerHelper({ // Removed sendSuccess, sendError
    logger,
    controllerName: 'KakaoController',
    actionName: 'addFriends',
    defaultErrMessage: '카카오 친구 추가 처리 중 오류가 발생했습니다.'
  });

  try {
    validateRequiredFields(req.body, ['friends']);
    const { friends } = req.body;

    if (!Array.isArray(friends)) {
      // return sendError(res, 'friends 필드는 배열이어야 합니다.', 400);
      const error = new Error('friends 필드는 배열이어야 합니다.');
      error.statusCode = 400;
      throw error;
    }

    const friendsWithName = friends.map(f => ({
      ...f,
      username: makeKakaoFriendName(f.company_name, f.contact_person)
    }));

    controllerLogger.debug('Sending add-friends request to Kakao service', { count: friendsWithName.length });
    const response = await axios.post('http://localhost:5001/kakao/add-friends', { friends: friendsWithName });
    const resultList = response.data?.results || [];
    controllerLogger.debug('Received response from Kakao service for add-friends', { resultCount: resultList.length });

    const successPhones = resultList.filter(r => r.status === 'success').map(r => r.phone);
    const alreadyPhones = resultList.filter(r => r.status === 'already_registered').map(r => r.phone);
    const failPhones = resultList.filter(r => r.status === 'fail' || r.status === 'not_allowed').map(r => r.phone);

    if (successPhones.length > 0) {
      await handleDbOperation(
        ContactInfo.update(
          { friend_add_status: 'success' },
          { where: { phone_number: { [Op.in]: successPhones } } }
        ),
        { operationName: 'Update success friend status' }
      );
    }
    if (alreadyPhones.length > 0) {
      await handleDbOperation(
        ContactInfo.update(
          { friend_add_status: 'already_registered' },
          { where: { phone_number: { [Op.in]: alreadyPhones } } }
        ),
        { operationName: 'Update already_registered friend status' }
      );
    }
    if (failPhones.length > 0) {
      await handleDbOperation(
        ContactInfo.update(
          { friend_add_status: 'fail' },
          { where: { phone_number: { [Op.in]: failPhones } } }
        ),
        { operationName: 'Update fail friend status' }
      );
    }
    // sendSuccess(res, { results: resultList });
    return { results: resultList }; // Return data
  } catch (e) {
    let errorMsg = e.message;
    let statusCode = 500;
    if (e.isValidationError) {
      errorMsg = e.message;
      statusCode = 400;
    } else if (e.response && e.response.data && e.response.data.detail) {
      errorMsg = e.response.data.detail;
      statusCode = e.response.status || 500;
    }
    controllerLogger.error('Error in addFriends:', e);
    // sendError(res, errorMsg, statusCode);
    const error = new Error(errorMsg);
    error.statusCode = statusCode;
    if (e.isAxiosError && e.response) { // Capture more details from Axios errors
        error.externalResponse = {
            status: e.response.status,
            data: e.response.data
        };
    }
    throw error; // Throw error
  }
};

export const sendMessages = async (req) => { // Removed res
  const { handleDbOperation, logger: controllerLogger, validateRequiredFields } = createControllerHelper({ // Removed sendSuccess, sendError
    logger,
    controllerName: 'KakaoController',
    actionName: 'sendMessages',
    defaultErrMessage: '카카오 메시지 전송 처리 중 오류가 발생했습니다.'
  });

  try {
    validateRequiredFields(req.body, ['message_groups']);
    const { message_groups } = req.body;

    if (!Array.isArray(message_groups)) {
      // return sendError(res, 'message_groups 필드는 배열이어야 합니다.', 400);
      const error = new Error('message_groups 필드는 배열이어야 합니다.');
      error.statusCode = 400;
      throw error;
    }

    const originalGroups = JSON.parse(JSON.stringify(message_groups));
    controllerLogger.info(`Frontend image root directory: ${FRONTEND_IMAGE_ROOT}`);


    const flattenedGroups = message_groups.map(group => ({
      username: group.username,
      messages: group.messages.flatMap(msg => {
        if (msg.type === 'image') {
          let contentArray = typeof msg.content === 'string'
            ? msg.content.split(',').map(p => p.trim()).filter(p => p)
            : Array.isArray(msg.content)
              ? msg.content
              : [];
          const absArray = contentArray.map(relativePath => {
            const cleaned = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
            return path.join(FRONTEND_IMAGE_ROOT, cleaned);
          }).filter(p => p.startsWith(FRONTEND_IMAGE_ROOT));

          if (absArray.length === 0) {
            controllerLogger.warn('Image message with no valid content after path transformation, skipping message part.', { originalContent: msg.content });
            return [];
          }
          return [{ type: 'image', content: absArray.join(',') }];
        }
        return [{ type: msg.type, content: msg.content }];
      })
    }));

    controllerLogger.debug(`Sending ${flattenedGroups.length} flattened groups to FastAPI.`);
    const response = await axios.post('http://localhost:5001/kakao/send-messages', { message_groups: flattenedGroups });
    const results = response.data.results || [];
    controllerLogger.debug(`Received ${results.length} results from FastAPI.`);

    const createdLogs = [];
    for (const r of results) {
      const { username, phone, status, reason } = r;
      let contact = null;
      let contactPersonName = '';

      if (username && username.includes('-')) {
        const parts = username.split('-');
        contactPersonName = parts[parts.length - 1].trim();
      } else {
        contactPersonName = username;
      }

      if (contactPersonName) {
        try {
          contact = await handleDbOperation(
            ContactInfo.findOne({
              where: { contact_person: contactPersonName },
              include: [{ model: CustomerInfo, through: CustomerContactMap }]
            }),
            { operationName: 'FindContactInfoForLogging', suppressError: true } // suppressError to allow custom handling below
          );
        } catch (dbError) {
            controllerLogger.error(`Error finding contact for ${contactPersonName}: ${dbError.message}. Skipping log.`);
            continue;
        }
      }

      if (!contact) {
        controllerLogger.warn(`Contact not found for contact_person: ${contactPersonName} (username: ${username}). Skipping log.`);
        continue;
      }

      if (!contact.CustomerInfos || contact.CustomerInfos.length === 0) {
        controllerLogger.warn(`Contact ${contact.id} (${contactPersonName}) has no associated CustomerInfo. Skipping log.`);
        continue;
      }

      const customer = contact.CustomerInfos[0];
      const customer_id = customer.id;

      const originalGroup = originalGroups.find(g => g.username === username);
      const contentString = originalGroup && Array.isArray(originalGroup.messages)
        ? originalGroup.messages.map(m => {
            if (m.type === 'image' && Array.isArray(m.content)) {
              return `[Image: ${m.content.join(', ')}]`;
            }
            return m.content;
          }).join(' | ')
        : '';
      
      try {
        const logEntry = await handleDbOperation(
          MarketingMessageLog.create({
            customer_id: customer_id,
            contact_id: contact.id,
            message_content: contentString || phone || '',
            status: status === 'success' ? 'success' : 'failed',
            sent_at: new Date(),
            fail_reason: status !== 'success' ? reason : null
          }),
          { operationName: 'CreateMarketingMessageLog', suppressError: true } // suppressError to allow custom handling below
        );
        if (logEntry) { // handleDbOperation might return null if suppressed and failed
            createdLogs.push(logEntry);
        } else {
            controllerLogger.error(`Failed to create marketing log for customer ${customer_id}, contact ${contact.id} (username: ${username}) due to a suppressed error during DB operation.`);
        }
      } catch (dbError) {
          controllerLogger.error(`Error creating marketing log for ${username}: ${dbError.message}.`);
          // Continue to next result even if one log fails
      }
    }
    controllerLogger.info(`Marketing logs created: ${createdLogs.length}`);
    // sendSuccess(res, { results });
    return { results }; // Return data
  } catch (error) {
    let errorMsg = error.message;
    let statusCode = 500;

    if (error.isValidationError) {
        errorMsg = error.message;
        statusCode = 400;
    } else if (error.response?.data?.detail) {
        errorMsg = error.response.data.detail;
        statusCode = error.response.status || 500;
    } else if (error.isAxiosError) {
        errorMsg = `External API call failed: ${error.message}`;
        statusCode = error.response?.status || 503; // Service Unavailable or specific error
    }
    
    controllerLogger.error('Error in sendMessages:', error.stack || error);
    // sendError(res, errorMsg, statusCode, { stack: error.stack }); // Include stack in dev/debug
    const err = new Error(errorMsg); // Renamed to avoid conflict with outer 'error'
    err.statusCode = statusCode;
    err.stack = error.stack; // Preserve original stack
     if (error.isAxiosError && error.response) { // Capture more details from Axios errors
        err.externalResponse = {
            status: error.response.status,
            data: error.response.data
        };
    }
    throw err; // Throw error
  }
};
