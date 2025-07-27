import CustomerInfo from '../models/CustomerInfo.js';
import ContactInfo from '../models/ContactInfo.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';

const { handleDbOperation, logger } = createControllerHelper('CustomerController');

// 모든 고객 정보 조회
export const getAllCustomers = async (req) => {
  logger.debug('Attempting to fetch all customers');
  const customers = await handleDbOperation(async () => {
    return await CustomerInfo.findAll({
      include: [{
        model: ContactInfo,
        attributes: ['id', 'phone_number', 'contact_person', 'favorite', 'blacklist', 'friend_add_status']
      }]
    });
  }, '모든 고객 정보 조회');
  
  logger.info(`Successfully fetched ${customers.length} customers.`);
  return customers;
};

// 특정 고객 정보 조회
export const getCustomerById = async (req) => {
  const { id } = req.params;
  logger.debug(`Attempting to fetch customer by ID: ${id}`);
  
  const customer = await handleDbOperation(async () => {
    return await CustomerInfo.findByPk(id, {
      include: [{
        model: ContactInfo,
        attributes: ['id', 'phone_number', 'contact_person', 'favorite', 'blacklist', 'friend_add_status']
      }]
    });
  }, `고객 ID ${id} 조회`);
  
  if (!customer) {
    const error = new Error(`고객 정보 (ID: ${id})를 찾을 수 없습니다.`);
    error.statusCode = 404;
    logger.warn(error.message);
    throw error;
  }
  
  logger.info(`Successfully fetched customer with ID: ${id}.`);
  return customer;
};

// 특정 공고 ID로 고객 정보 조회
export const getCustomerByPostingId = async (req) => {
  const { postingId } = req.params;
  logger.debug(`Attempting to fetch customer by posting ID: ${postingId}`);
  
  const customer = await handleDbOperation(async () => {
    return await CustomerInfo.findOne({
      where: { posting_id: postingId },
      include: [{
        model: ContactInfo,
        attributes: ['id', 'phone_number', 'contact_person', 'favorite', 'blacklist', 'friend_add_status']
      }]
    });
  }, `공고 ID ${postingId} 조회`);
  
  if (!customer) {
    const error = new Error(`해당 공고 ID(${postingId})의 고객 정보를 찾을 수 없습니다.`);
    error.statusCode = 404;
    logger.warn(error.message);
    throw error;
  }
  
  logger.info(`Successfully fetched customer with posting ID: ${postingId}.`);
  return customer;
};

// 특정 공고 ID로 연락처 정보 모두 조회
export const getContactsByPostingId = async (req) => {
  const { postingId } = req.params;
  logger.debug(`Attempting to fetch contacts by posting ID: ${postingId}`);
  
  const contacts = await handleDbOperation(async () => {
    return await ContactInfo.findAll({
      where: { posting_id: postingId },
      include: [{
        model: CustomerInfo,
        attributes: ['title', 'company_name', 'address']
      }]
    });
  }, `공고 ID ${postingId}의 모든 연락처 조회`);
  
  if (!contacts || contacts.length === 0) {
    const error = new Error(`해당 공고 ID(${postingId})의 연락처 정보를 찾을 수 없습니다.`);
    error.statusCode = 404;
    logger.warn(error.message);
    throw error;
  }
  
  logger.info(`Successfully fetched ${contacts.length} contacts for posting ID: ${postingId}.`);
  return contacts;
};
