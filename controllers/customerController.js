import { createLogger } from '../lib/logger.js';
import CustomerInfo from '../models/CustomerInfo.js';
import ContactInfo from '../models/ContactInfo.js';

const logger = createLogger('CustomerController');

// 모든 고객 정보 조회
export const getAllCustomers = async (req, res) => {
  try {
    logger.debug('모든 고객 정보 조회 요청');
    
    const customers = await CustomerInfo.findAll({
      include: [{
        model: ContactInfo,
        attributes: ['phone_number', 'contact_person']
      }]
    });
    
    return res.json({
      success: true,
      count: customers.length,
      data: customers
    });
  } catch (error) {
    logger.error(`고객 정보 조회 중 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 특정 고객 정보 조회
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    logger.debug(`고객 ID ${id} 조회 요청`);
    
    const customer = await CustomerInfo.findByPk(id, {
      include: [{
        model: ContactInfo,
        attributes: ['phone_number', 'contact_person']
      }]
    });
    
    if (!customer) {
      logger.warn(`ID ${id}에 해당하는 고객 정보 없음`);
      return res.status(404).json({
        success: false,
        message: '해당 ID의 고객 정보를 찾을 수 없습니다'
      });
    }
    
    return res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    logger.error(`고객 정보 조회 중 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 특정 공고 ID로 고객 정보 조회
export const getCustomerByPostingId = async (req, res) => {
  try {
    const { postingId } = req.params;
    logger.debug(`공고 ID ${postingId} 조회 요청`);
    
    const customer = await CustomerInfo.findOne({
      where: { posting_id: postingId },
      include: [{
        model: ContactInfo,
        attributes: ['phone_number', 'contact_person']
      }]
    });
    
    if (!customer) {
      logger.warn(`공고 ID ${postingId}에 해당하는 고객 정보 없음`);
      return res.status(404).json({
        success: false,
        message: '해당 공고 ID의 고객 정보를 찾을 수 없습니다'
      });
    }
    
    return res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    logger.error(`고객 정보 조회 중 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 특정 공고 ID로 연락처 정보 모두 조회
export const getContactsByPostingId = async (req, res) => {
  try {
    const { postingId } = req.params;
    logger.debug(`공고 ID ${postingId}의 모든 연락처 조회 요청`);
    
    const contacts = await ContactInfo.findAll({
      where: { posting_id: postingId },
      include: [{
        model: CustomerInfo,
        attributes: ['title', 'company_name', 'address']
      }]
    });
    
    if (!contacts || contacts.length === 0) {
      logger.warn(`공고 ID ${postingId}에 해당하는 연락처 정보 없음`);
      return res.status(404).json({
        success: false,
        message: '해당 공고 ID의 연락처 정보를 찾을 수 없습니다'
      });
    }
    
    return res.json({
      success: true,
      count: contacts.length,
      data: contacts
    });
  } catch (error) {
    logger.error(`연락처 정보 조회 중 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
