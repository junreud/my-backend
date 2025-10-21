import { createLogger } from '../lib/logger.js';
import { sendSuccess, sendError } from '../lib/response.js';

/**
 * Centralized error handling and response utilities for controllers
 * Eliminates duplicate error handling patterns across controllers
 */

/**
 * Creates a controller helper with consistent error handling and response patterns
 * @param {string} controllerName - Name of the controller for logging
 * @returns {Object} Helper functions for the controller
 */
export function createControllerHelper(options) { // Changed parameter name from controllerName to options
  const controllerSpecificLogger = createLogger(options.controllerName); // Use options.controllerName

  /**
   * Handles async controller functions with automatic error handling
   * @param {Function} fn - Async controller function to wrap
   * @returns {Function} Wrapped controller function
   */
  const asyncHandler = (fn) => {
    return async (req, res, next) => {
      try {
        await fn(req, res, next);
      } catch (error) {
        controllerSpecificLogger.error(`${fn.name || 'Controller'} error: ${error.message}`); // Use controllerSpecificLogger
        return sendError(res, 500, error.message);
      }
    };
  };

  // Use imported response helpers from lib/response.js

  /**
   * Validates required fields in request body
   * @param {Object} body - Request body
   * @param {string[]} requiredFields - Array of required field names
   * @returns {Object|null} Error object if validation fails, null if valid
   */
  const validateRequiredFields = (body, requiredFields) => {
    const missingFields = requiredFields.filter(field => 
      body[field] === undefined || body[field] === null || body[field] === ''
    );
    
    if (missingFields.length > 0) {
      return {
        message: `다음 필드가 필요합니다: ${missingFields.join(', ')}`,
        missingFields
      };
    }
    
    return null;
  };

  /**
   * Handles database operation with automatic error handling
   * @param {Function} operation - Database operation function
   * @param {string} operationName - Name of the operation for logging
   * @returns {*} Operation result or throws error
   */
  const handleDbOperation = async (operationFn, operationDetails) => { // Renamed operation to operationFn
    const operationName = typeof operationDetails === 'string' ? operationDetails : operationDetails.operationName || 'Database operation';
    try {
      controllerSpecificLogger.debug(`${operationName} 시작`); // Use controllerSpecificLogger
      const result = await operationFn(); // Call operationFn
      controllerSpecificLogger.debug(`${operationName} 완료`); // Use controllerSpecificLogger
      return result;
    } catch (error) {
      controllerSpecificLogger.error(`${operationName} 중 오류: ${error.message}`, error); // Use controllerSpecificLogger
      throw error;
    }
  };

  /**
   * Handles not found scenarios with consistent response
   * @param {Object} res - Express response object
   * @param {string} resourceName - Name of the resource not found
   * @param {*} identifier - Resource identifier
   * @returns {Object} Express response
   */
  const handleNotFound = (res, resourceName, identifier = null) => {
    const message = identifier 
      ? `${resourceName} ID ${identifier}을(를) 찾을 수 없습니다`
      : `${resourceName}을(를) 찾을 수 없습니다`;
    
    controllerSpecificLogger.warn(message); // Use controllerSpecificLogger
    return sendError(res, 404, message);
  };

  /**
   * Validates array input with automatic error response
   * @param {Object} res - Express response object
   * @param {*} data - Data to validate as array
   * @param {string} fieldName - Name of the field for error message
   * @returns {boolean} True if valid, false if invalid (response already sent)
   */
  const validateArray = (res, data, fieldName = 'data') => {
    if (!Array.isArray(data) || data.length === 0) {
      sendError(res, 400, `유효한 ${fieldName} 배열이 필요합니다`);
      return false;
    }
    return true;
  };

  /**
   * Logs and returns standard operation result
   * @param {string} operation - Operation description
   * @param {*} result - Operation result
   * @param {*} identifier - Resource identifier (optional)
   * @returns {*} The result
   */
  const logOperationResult = (operation, result, identifier = null) => {
    const idText = identifier ? ` (ID: ${identifier})` : '';
    controllerSpecificLogger.info(`${operation} 완료${idText}`);
    return result;
  };

  return {
    asyncHandler,
    validateRequiredFields,
    handleDbOperation,
    handleNotFound,
    validateArray,
    logOperationResult,
    logger: controllerSpecificLogger // Return the controller-specific logger
  };
}

/**
 * Common response patterns used across multiple controllers
 */
export const ResponsePatterns = {
  /**
   * Standard CRUD success messages
   */
  MESSAGES: {
    CREATED: '생성되었습니다',
    UPDATED: '업데이트되었습니다',
    DELETED: '삭제되었습니다',
    FOUND: '조회되었습니다'
  },

  /**
   * Standard HTTP status codes
   */
  STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_ERROR: 500
  }
};

/**
 * Database operation helper patterns
 */
export const DbPatterns = {
  /**
   * Find or create pattern with error handling
   * @param {Object} model - Sequelize model
   * @param {Object} whereClause - Where condition
   * @param {Object} defaults - Default values for creation
   * @param {string} resourceName - Resource name for logging
   * @returns {Object} { instance, created }
   */
  async findOrCreateSafely(model, whereClause, defaults, resourceName = 'Resource') {
    try {
      const [instance, created] = await model.findOrCreate({
        where: whereClause,
        defaults
      });
      return { instance, created };
    } catch (error) {
      throw new Error(`${resourceName} 생성/조회 중 오류: ${error.message}`);
    }
  },

  /**
   * Update with existence check
   * @param {Object} model - Sequelize model
   * @param {*} id - Resource ID
   * @param {Object} updateData - Data to update
   * @param {string} resourceName - Resource name for logging
   * @returns {Object} Updated instance
   */
  async updateSafely(model, id, updateData, resourceName = 'Resource') {
    const instance = await model.findByPk(id);
    if (!instance) {
      throw new Error(`${resourceName}을(를) 찾을 수 없습니다`);
    }
    
    await instance.update(updateData);
    return instance;
  },

  /**
   * Delete with existence check
   * @param {Object} model - Sequelize model
   * @param {*} id - Resource ID
   * @param {string} resourceName - Resource name for logging
   * @returns {boolean} True if deleted
   */
  async deleteSafely(model, id, resourceName = 'Resource') {
    const instance = await model.findByPk(id);
    if (!instance) {
      throw new Error(`${resourceName}을(를) 찾을 수 없습니다`);
    }
    
    await instance.destroy();
    return true;
  }
};
