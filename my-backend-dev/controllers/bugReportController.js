import BugReport from '../models/BugReport.js';
import { createControllerHelper, ResponsePatterns } from '../utils/controllerHelpers.js';

const { handleDbOperation, logger } = createControllerHelper('BugReportController');

export const createBugReport = async (req) => {
  logger.debug('Attempting to create bug report');
  try {
    const { category, title, description, contactPhone, contactEmail } = req.body;
    
    const report = await handleDbOperation(async () => {
      let screenshot_url = null;
      if (req.file) {
        // 저장된 파일 경로를 클라이언트에서 접근 가능한 URL로 설정
        screenshot_url = `/uploads/bug_screenshots/${req.file.filename}`;
        logger.debug(`Screenshot uploaded: ${screenshot_url}`);
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

    logger.info(`Bug report created successfully with ID: ${report.id}`);
    return { data: report, message: '버그 리포트가 생성되었습니다', statusCode: ResponsePatterns.STATUS.CREATED };
  } catch (error) {
    logger.error('Error creating bug report:', error);
    const err = new Error('버그 리포트 저장에 실패했습니다');
    err.statusCode = ResponsePatterns.STATUS.INTERNAL_ERROR;
    throw err;
  }
};
