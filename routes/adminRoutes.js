// routes/adminRoutes.js
import express from 'express';
import passport from 'passport';
import WorkHistory from '../models/WorkHistory.js';
import User from '../models/User.js';
import Place from '../models/Place.js';
import { Op } from 'sequelize';
import { createLogger } from "../lib/logger.js";

const logger = createLogger("AdminRoutesLogger");
const router = express.Router();
// 관리자 전용 작업 이력 조회 API (최적화됨)
router.get('/work-histories', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
      // 인증된 사용자가 admin 권한을 가지고 있는지 철저히 검증
      if (!req.user || req.user.role !== 'admin') {
        logger.warn(`권한 없는 접근 시도: ${req.user ? req.user.email : 'Unknown'} (role: ${req.user ? req.user.role : 'None'})`);
        return res.status(403).json({ 
          success: false, 
          message: "관리자 권한이 필요한 작업입니다." 
        });
      }
      
      // 쿼리 파라미터 추출 (limit/offset만 사용, userId는 무시)
      const { limit = 100, offset = 0 } = req.query;
      
      logger.debug(`[DEBUG] /work-histories 작업 이력 전체 조회: limit=${limit}, offset=${offset}`);
      
      // 관리자는 항상 모든 작업 이력을 조회 (userId 필터링 없음)
      const workHistories = await WorkHistory.findAll({
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        order: [['id', 'DESC']]
      });
      
      logger.debug(`[DEBUG] 모든 작업 이력 조회 결과: ${workHistories.length}개`);
      
      // 로그에 응답 데이터 기록
      logger.info(`관리자(${req.user.email})에게 모든 work-histories 응답 전송: ${workHistories.length}개 항목`);
      
      // 클라이언트에 응답
      res.json({
        success: true,
        data: workHistories
      });
      
    } catch (error) {
      logger.error('관리자 작업 이력 조회 오류:', error);
      res.status(500).json({ 
        success: false, 
        message: '서버 오류가 발생했습니다.' 
      });
    }
  });
  
  // 관리자 전용 작업 이력 생성 API
  router.post('/work-histories', passport.authenticate('jwt', { session: false }), async (req, res) => {
      try {
        // 관리자 권한 검증
        if (!req.user || req.user.role !== 'admin') {
          logger.warn(`권한 없는 작업 이력 생성 시도: ${req.user ? req.user.email : 'Unknown'} (role: ${req.user ? req.user.role : 'None'})`);
          return res.status(403).json({ 
            success: false, 
            message: "관리자 권한이 필요한 작업입니다." 
          });
        }
        
        // 필수 필드 검증
        const requiredFields = ['user_id', 'place_id', 'work_type', 'executor'];
        for (const field of requiredFields) {
          if (!req.body[field]) {
            return res.status(400).json({ 
              success: false, 
              message: `필수 항목이 누락되었습니다: ${field}` 
            });
          }
        }
        
        // 작업 종류 유효성 검사 (enum 타입)
        const validWorkTypes = ["트래픽", "저장하기", "블로그배포"];
        if (!validWorkTypes.includes(req.body.work_type)) {
          return res.status(400).json({
            success: false,
            message: "유효하지 않은 work_type입니다. '트래픽', '저장하기', '블로그배포' 중 하나여야 합니다."
          });
        }
    
        // 날짜 타입 변환
        const dateFields = ['actual_start_date', 'actual_end_date', 'user_start_date', 'user_end_date'];
        const workHistoryData = { ...req.body };
        
        dateFields.forEach(field => {
          if (workHistoryData[field]) {
            workHistoryData[field] = new Date(workHistoryData[field]);
          }
        });
        
        // 숫자 타입 변환
        if (workHistoryData.user_id) {
          workHistoryData.user_id = parseInt(workHistoryData.user_id, 10);
        }
        
        if (workHistoryData.char_count) {
          workHistoryData.char_count = parseInt(workHistoryData.char_count, 10);
        }
        
        // 작업 이력 생성
        const newWorkHistory = await WorkHistory.createWorkHistory(workHistoryData);
        
        logger.info(`새 작업 이력이 생성되었습니다: ID ${newWorkHistory.id}, 사용자 ${workHistoryData.user_id}`);
        
        // 로그에 응답 데이터 기록
        logger.info(`관리자(${req.user.email})에게 생성된 작업 이력 응답 전송: ID ${newWorkHistory.id}`);
        // 개발 환경에서만 상세 데이터 로깅
        if (process.env.NODE_ENV === 'development') {
          logger.debug(`응답 데이터: ${JSON.stringify(newWorkHistory)}`);
        }
        
        res.status(201).json({
          success: true,
          message: '작업 이력이 성공적으로 생성되었습니다.',
          data: newWorkHistory
        });
        
      } catch (error) {
        logger.error('작업 이력 생성 오류:', error);
        res.status(500).json({ 
          success: false, 
          message: '서버 오류가 발생했습니다.' 
        });
      }
    });
/**
 * GET /api/admin/users-with-places
 * 관리자 전용 API - 모든 일반 사용자와 그들의 등록 업체 정보 조회
 */
router.get('/users-with-places', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
      // 1. 요청한 사용자가 관리자인지 확인
      if (!req.user || req.user.role !== 'admin') {
        logger.warn(`권한 없는 사용자 정보 조회 시도: ${req.user ? req.user.email : 'Unknown'}`);
        return res.status(403).json({ 
          success: false, 
          message: "관리자 권한이 필요한 작업입니다." 
        });
      }
  
      // 2. 모든 일반 사용자(admin 제외) 조회 - 필터링 조건 추가
      const users = await User.findAll({
        where: {
          role: { [Op.ne]: 'admin' }, // admin이 아닌 사용자들만
          email: { [Op.ne]: null },   // 이메일이 있는 사용자만
          name: { [Op.ne]: null }     // 이름이 있는 사용자만
        },
        attributes: ['id', 'name', 'email', 'phone'], // 필요한 필드만 선택
        include: [{
          model: Place,
          as: 'places',
          attributes: ['place_name'], // 업체명만 필요
          required: true             // 최소 1개 이상의 업체가 있는 사용자만 (INNER JOIN)
        }]
      });
  
      // 3. 결과 가공
      const formattedUsers = users.map(user => {
        // 사용자가 가진 모든 업체명을 배열로 추출
        const placeNames = user.places.map(place => place.place_name);
        
        return {
          user_id: user.id,
          name: user.name,          // 이미 null이 아님이 보장됨
          email: user.email,        // 이미 null이 아님이 보장됨
          phone: user.phone || '연락처 없음',
          place_names: placeNames,  // 최소 1개 이상 존재함이 보장됨
          place_count: placeNames.length
        };
      });
  
      logger.info(`관리자(${req.user.email})가 사용자 목록 조회: ${formattedUsers.length}명 조회됨`);
  
      // 4. 응답 전송
      res.json({
        success: true,
        data: formattedUsers
      });
    } catch (error) {
      logger.error('사용자-업체 정보 조회 오류:', error);
      res.status(500).json({ 
        success: false, 
        message: '서버 오류가 발생했습니다.' 
      });
    }
  });

export default router;