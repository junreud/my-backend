import ContactInfo from '../models/ContactInfo.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';

const { handleDbOperation, logger } = createControllerHelper('ContactController');

export const updateFavorite = async (req) => {
  const { contactId } = req.params;
  const { favorite } = req.body;
  
  logger.debug(`Attempting to update favorite for contactId: ${contactId} to ${favorite}`);
  await handleDbOperation(async () => {
    const [affectedRows] = await ContactInfo.update(
      { favorite },
      { where: { id: contactId } }
    );
    if (affectedRows === 0) {
      const error = new Error(`Contact with ID ${contactId} not found.`);
      error.statusCode = 404;
      throw error;
    }
    return affectedRows;
  }, `즐겨찾기 업데이트 (contact ${contactId})`);
  
  logger.info(`Favorite status updated for contactId: ${contactId} to ${favorite}`);
  return { data: { contactId, favorite }, message: 'Favorite status updated successfully.' };
};

export const updateBlacklist = async (req) => {
  const { contactId } = req.params;
  const { blacklist } = req.body;

  logger.debug(`Attempting to update blacklist for contactId: ${contactId} to ${blacklist}`);
  await handleDbOperation(async () => {
    const [affectedRows] = await ContactInfo.update(
      { blacklist },
      { where: { id: contactId } }
    );
    if (affectedRows === 0) {
      const error = new Error(`Contact with ID ${contactId} not found.`);
      error.statusCode = 404;
      throw error;
    }
    return affectedRows;
  }, `블랙리스트 업데이트 (contact ${contactId})`);

  logger.info(`Blacklist status updated for contactId: ${contactId} to ${blacklist}`);
  return { data: { contactId, blacklist }, message: 'Blacklist status updated successfully.' };
};