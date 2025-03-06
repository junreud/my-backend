// routes/userRoutes.js
import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// (GET) /users/role-check
// 현재 로그인한 사용자의 role 반환
router.get('/role-check', authenticate, async (req, res) => {
  try {
    // 1) 로그인 여부 확인
    if (!req.user) {
      // 로그인 안 한 상태
      return res.json({
        isLoggedIn: false,
        role: null,
      });
    }

    // 2) DB에서 사용자 조회
    const user = await User.findByPk(req.user.id);
    if (!user) {
      // 세션/토큰에는 user id가 있지만, DB에 해당 사용자가 없을 수도 있음
      return res.json({
        isLoggedIn: false,
        role: null,
      });
    }

    // 3) role 분기 처리
    //    - 'admin'이면 → 관리자
    //    - 'user'이면 → 일반 사용자
    //    - 둘 다 아니지만 로그인은 되어 있음 → 'pending'(심사중)으로 가정
    let roleResult = '';
    if (user.role === 'admin') {
      roleResult = 'admin';
    } else if (user.role === 'user') {
      roleResult = 'user';
    } else {
      // 예: 아직 role 설정이 안 되었거나, 별도 상태인 경우
      roleResult = 'pending'; // 심사중
    }

    return res.json({
      isLoggedIn: true,
      role: roleResult,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: '서버 오류',
    });
  }
});

export default router;