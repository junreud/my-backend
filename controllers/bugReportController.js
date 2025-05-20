import BugReport from '../models/BugReport.js';
import path from 'path';

export const createBugReport = async (req, res) => {
  try {
    const { category, title, description, contactPhone, contactEmail } = req.body;
    let screenshot_url = null;
    if (req.file) {
      // 저장된 파일 경로를 클라이언트에서 접근 가능한 URL로 설정
      screenshot_url = `/uploads/bug_screenshots/${req.file.filename}`;
    }
    const report = await BugReport.create({
      category,
      title,
      description,
      screenshot_url,
      contact_phone: contactPhone,
      contact_email: contactEmail,
    });
    return res.status(201).json(report);
  } catch (error) {
    console.error('BugReportController error:', error);
    return res.status(500).json({ error: 'Failed to save bug report.' });
  }
};
