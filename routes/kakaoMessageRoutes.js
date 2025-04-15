import express from 'express';
import { addKakaoFriends } from '../controllers/kakaoAutomationController.js';

const router = express.Router();
router.post('/kakao/friends/add', addKakaoFriends);
export default router;