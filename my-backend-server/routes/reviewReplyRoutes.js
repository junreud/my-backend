import express from 'express';
import { authenticateJWT } from '../middlewares/auth.js';
import {
  getReplySettings,
  saveReplySettings,
  generateAIReplies,
  generateSingleAIReply,
  getReplySettingsTemplates,
  generateReplyWithTemplate
} from '../controllers/reviewReplyController.js';

const router = express.Router();

// AI 답변 설정 조회
router.get('/settings/:placeId', authenticateJWT, getReplySettings);

// AI 답변 설정 저장
router.post('/settings/:placeId', authenticateJWT, saveReplySettings);

// TODO: Implement these routes when needed
// // 답변 없는 리뷰 조회
// router.get('/unanswered/:placeId', authenticateJWT, getUnansweredReviews);

// // AI 답변 생성
// router.post('/generate/:placeId', authenticateJWT, generateReplies);

// // 생성된 답변 조회
// router.get('/generated/:placeId', authenticateJWT, getGeneratedReplies);

// // 답변 수정
// router.put('/reply/:replyId', authenticateJWT, updateReply);

// === ChatGPT AI 답변 생성 기능 ===
// ChatGPT 답변 설정 조회
router.get('/ai-settings/:placeId', authenticateJWT, getReplySettings);

// ChatGPT 답변 설정 저장
router.post('/ai-settings/:placeId', authenticateJWT, saveReplySettings);

// ChatGPT 답변 일괄 생성
router.post('/ai-generate/:placeId', authenticateJWT, generateAIReplies);

// ChatGPT 단일 답변 생성
router.post('/ai-generate-single/:reviewId', authenticateJWT, generateSingleAIReply);

// === 새로운 템플릿 기능 ===
// 저장된 답변 설정 템플릿 목록 조회
router.get('/templates/:placeId', authenticateJWT, getReplySettingsTemplates);

// 선택된 템플릿으로 즉시 답변 생성
router.post('/generate-with-template/:reviewId', authenticateJWT, generateReplyWithTemplate);

export default router;
