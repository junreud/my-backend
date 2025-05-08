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

/**
 * GET /api/admin/work-histories/options
 * 관리자 전용 - 작업 이력 옵션 목록 조회 (작업 유형, 필터링 옵션 등)
 */
router.get('/work-histories/options', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    // 관리자 권한 검증
    if (!req.user || req.user.role !== 'admin') {
      logger.warn(`권한 없는 작업 이력 옵션 조회 시도: ${req.user ? req.user.email : 'Unknown'}`);
      return res.status(403).json({ 
        success: false, 
        message: "관리자 권한이 필요한 작업입니다." 
      });
    }

    // 작업 유형 옵션 목록 (enum과 일치하게 유지)
    const workTypeOptions = ["트래픽", "저장하기", "블로그배포"];
    
    // 실행사 옵션 목록 추가
    const executorOptions = ["토스", "호올스"];
    
    // 자주 사용되는 필터링 옵션들
    const filterOptions = {
      status: ["완료", "진행중", "대기중", "실패"],
      sortBy: ["최신순", "오래된순", "사용자명", "업체명"]
    };

    logger.info(`관리자(${req.user.email})가 작업 이력 옵션 조회`);
    
    res.json({
      success: true,
      data: {
        workTypes: workTypeOptions,
        executors: executorOptions,
        filters: filterOptions
      }
    });
    
  } catch (error) {
    logger.error('작업 이력 옵션 조회 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
});

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

router.delete('/work-histories/:id', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        logger.info(`DELETE 요청 수신: /api/admin/work-histories/${req.params.id}`);
        
        // 1. 관리자 권한 검증
        if (!req.user || req.user.role !== 'admin') {
            logger.warn(`권한 없는 작업 이력 삭제 시도: ${req.user ? req.user.email : 'Unknown'} (role: ${req.user ? req.user.role : 'None'})`);
            return res.status(403).json({ 
                success: false, 
                message: "관리자 권한이 필요한 작업입니다." 
            });
        }
    
        // 2. 요청 경로에서 작업 이력 ID 추출
        const workHistoryId = parseInt(req.params.id, 10);
        logger.debug(`작업 이력 ID 파싱 결과: ${workHistoryId}`);
        
        if (isNaN(workHistoryId)) {
            logger.warn(`유효하지 않은 작업 이력 ID: ${req.params.id}`);
            return res.status(400).json({
                success: false,
                message: "유효하지 않은 작업 이력 ID입니다."
            });
        }
    
        // 3. 작업 이력 존재 확인
        logger.debug(`작업 이력 조회 시도: ID ${workHistoryId}`);
        const workHistory = await WorkHistory.findByPk(workHistoryId);
        logger.debug(`작업 이력 조회 결과: ${workHistory ? '찾음' : '찾지 못함'}`);
        
        if (!workHistory) {
            logger.warn(`존재하지 않는 작업 이력 삭제 시도: ID ${workHistoryId}`);
            return res.status(404).json({
                success: false,
                message: "해당 ID의 작업 이력을 찾을 수 없습니다."
            });
        }
    
        // 4. 작업 이력 삭제
        logger.debug(`작업 이력 삭제 시도: ID ${workHistoryId}`);
        await workHistory.destroy();
        logger.debug(`작업 이력 삭제 완료: ID ${workHistoryId}`);
        
        // 5. 삭제 성공 로그 기록
        logger.info(`관리자(${req.user.email})가 작업 이력을 삭제했습니다: ID ${workHistoryId}`);
    
        // 6. 성공 응답 전송
        res.json({
            success: true,
            message: "작업 이력이 성공적으로 삭제되었습니다."
        });
        
    } catch (error) {
        logger.error('작업 이력 삭제 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '서버 오류가 발생했습니다.' 
        });
    }
});

/**
 * GET /api/admin/users-with-places
 * 관리자 전용 API - 업체가 등록된 일반 사용자와 그들의 등록 업체 정보 조회
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
  
      // 2. 모든 일반 사용자(admin 제외) 조회 - 업체가 있는 사용자만 조회
      const users = await User.findAll({
        where: {
          role: { [Op.ne]: 'admin' } // admin이 아닌 사용자들만
        },
        attributes: ['id', 'name', 'email', 'phone'], // 필요한 필드만 선택
        include: [{
          model: Place,
          as: 'places',
          attributes: ['id', 'place_name'], // place_id와 업체명 함께 가져오기
          required: true // 업체가 있는 사용자만 포함 (INNER JOIN)
        }]
      });
  
      // 3. 결과 가공
      const formattedUsers = users.map(user => {
        // 사용자가 가진 모든 업체명과 ID를 배열로 추출
        const placeNames = user.places.map(place => place.place_name);
        const placeIds = user.places.map(place => place.id.toString()); // ID를 문자열로 변환하여 저장
        
        return {
          user_id: user.id,
          name: user.name || '이름 없음',
          email: user.email || '이메일 없음',
          phone: user.phone || '연락처 없음',
          place_names: placeNames,
          place_ids: placeIds,
          place_count: placeNames.length
        };
      });
  
      logger.info(`관리자(${req.user.email})가 사용자 목록 조회: ${formattedUsers.length}명 조회됨`);
      logger.debug(`API 응답 데이터 예시(첫번째 항목): ${JSON.stringify(formattedUsers[0] || {})}`);
  
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