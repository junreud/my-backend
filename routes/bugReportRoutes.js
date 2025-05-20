import express from 'express';
import multer from 'multer';
import { createBugReport } from '../controllers/bugReportController.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/bug_screenshots/' });

router.post('/', upload.single('screenshot'), createBugReport);

export default router;
