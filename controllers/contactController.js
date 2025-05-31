import ContactInfo from '../models/ContactInfo.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';

const { sendSuccess, sendError, handleDbOperation, logger } = createControllerHelper('ContactController');

export const updateFavorite = async (req, res) => {
  const { contactId } = req.params;
  const { favorite } = req.body;
  
  try {
    await handleDbOperation(async () => {
      return await ContactInfo.update(
        { favorite },
        { where: { id: contactId } }
      );
    }, `즐겨찾기 업데이트 (contact ${contactId})`);
    
    return sendSuccess(res, { contactId, favorite });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

export const updateBlacklist = async (req, res) => {
  const { contactId } = req.params;
  const { blacklist } = req.body;
  
  try {
    await handleDbOperation(async () => {
      return await ContactInfo.update(
        { blacklist },
        { where: { id: contactId } }
      );
    }, `블랙리스트 업데이트 (contact ${contactId})`);
    
    return sendSuccess(res, { contactId, blacklist });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};