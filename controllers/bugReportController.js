import BugReport from '../models/BugReport.js';
import { createControllerHelper, ResponsePatterns } from '../utils/controllerHelpers.js';

const { sendSuccess, sendError, handleDbOperation, logger } = createControllerHelper('BugReportController');

export const createBugReport = async (req, res) => {
  try {
    const { category, title, description, contactPhone, contactEmail } = req.body;
    
    const report = await handleDbOperation(async () => {
      let screenshot_url = null;
      if (req.file) {
        // 저장된 파일 경로를 클라이언트에서 접근 가능한 URL로 설정
        screenshot_url = `/uploads/bug_screenshots/${req.file.filename}`;
      }
      
      return await BugReport.create({
        category,
        title,
        description,
        screenshot_url,
        contact_phone: contactPhone,
        contact_email: contactEmail,
      });
    }, '버그 리포트 생성');

    return sendSuccess(res, report, '버그 리포트가 생성되었습니다', ResponsePatterns.STATUS.CREATED);
  } catch (error) {
    return sendError(res, ResponsePatterns.STATUS.INTERNAL_ERROR, '버그 리포트 저장에 실패했습니다');
  }
};
