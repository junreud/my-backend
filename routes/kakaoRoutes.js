import express from 'express';
import { addFriends, sendMessages } from '../controllers/kakaoController.js';

const router = express.Router();

router.post('/add-friends', addFriends);
router.post('/send-messages', sendMessages);

export default router;