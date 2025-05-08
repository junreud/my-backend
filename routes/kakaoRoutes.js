import express from 'express';
import passport from 'passport';
import { addFriends } from '../controllers/kakaoController.js';
import { createLogger } from '../lib/logger.js';
import { sendMessages } from '../controllers/kakaoController.js';

const logger = createLogger('KakaoRoutes');

const router = express.Router();
const authenticateJWT = passport.authenticate('jwt', { session: false });

// 컨트롤러 로직을 사용하여 친구추가 처리
router.post('/add-friends', authenticateJWT, addFriends);

// 컨트롤러 로직을 사용하여 메시지 전송 처리
router.post('/send', authenticateJWT, sendMessages);

export default router;