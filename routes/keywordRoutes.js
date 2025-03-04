/**
 * routes/keywordRoutes.js
 */
import express from 'express';
import { 
    normalizeUrlHandler, crawlAndAnalyzeHandler, groupKeywordsHandler 
} 
from '../controllers/keywordController.js';

const router = express.Router();

// 1) URL 정규화
router.get('/analysis/normalize', normalizeUrlHandler);
// 2) 크롤링 + ChatGPT + 검색량 조회
router.post('/analysis/crawl', crawlAndAnalyzeHandler);
// 3) 최종 그룹핑
router.post('/analysis/group', groupKeywordsHandler);

// router.get('/keyword/parallel-sse', getParallelSSE);
export default router;
