import CustomerInfo from '../models/CustomerInfo.js';
import ContactInfo from '../models/ContactInfo.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';

const { sendSuccess, sendError, handleDbOperation, handleNotFound, logger } = createControllerHelper('CustomerController');

// 모든 고객 정보 조회
export const getAllCustomers = async (req, res) => {
  try {
    const customers = await handleDbOperation(async () => {
      return await CustomerInfo.findAll({
        include: [{
          model: ContactInfo,
          attributes: ['id', 'phone_number', 'contact_person', 'favorite', 'blacklist', 'friend_add_status']
        }]
      });
    }, '모든 고객 정보 조회');
    
    return sendSuccess(res, customers);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// 특정 고객 정보 조회
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const customer = await handleDbOperation(async () => {
      return await CustomerInfo.findByPk(id, {
        include: [{
          model: ContactInfo,
          attributes: ['id', 'phone_number', 'contact_person', 'favorite', 'blacklist', 'friend_add_status']
        }]
      });
    }, `고객 ID ${id} 조회`);
    
    if (!customer) {
      return handleNotFound(res, '고객 정보', id);
    }
    
    return sendSuccess(res, customer);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// 특정 공고 ID로 고객 정보 조회
export const getCustomerByPostingId = async (req, res) => {
  try {
    const { postingId } = req.params;
    
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
      return handleNotFound(res, '해당 공고 ID의 고객 정보');
    }
    
    return sendSuccess(res, customer);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// 특정 공고 ID로 연락처 정보 모두 조회
export const getContactsByPostingId = async (req, res) => {
  try {
    const { postingId } = req.params;
    
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
      return handleNotFound(res, '해당 공고 ID의 연락처 정보');
    }
    
    return sendSuccess(res, contacts);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};
