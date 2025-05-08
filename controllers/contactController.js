import { createLogger } from '../lib/logger.js';
import ContactInfo from '../models/ContactInfo.js';

const logger = createLogger('ContactController');

export const updateFavorite = async (req, res) => {
  const { contactId } = req.params;
  const { favorite } = req.body;
  try {
    await ContactInfo.update(
      { favorite },
      { where: { id: contactId } }
    );
    return res.json({ success: true, contactId, favorite });
  } catch (error) {
    logger.error(`즐겨찾기 업데이트 중 오류 (contact ${contactId}): ${error.message}`);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateBlacklist = async (req, res) => {
  const { contactId } = req.params;
  const { blacklist } = req.body;
  try {
    await ContactInfo.update(
      { blacklist },
      { where: { id: contactId } }
    );
    return res.json({ success: true, contactId, blacklist });
  } catch (error) {
    logger.error(`블랙리스트 업데이트 중 오류 (contact ${contactId}): ${error.message}`);
    return res.status(500).json({ success: false, message: error.message });
  }
};