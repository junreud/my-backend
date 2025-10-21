import { createLogger } from '../lib/logger.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';
import Review from '../models/Review.js';
import NaverReviewCrawler from '../services/naverReviewCrawler.js';
import { autoCrawlIfNeeded } from '../utils/reviewCrawlTracker.js';
import { detectBlogAd } from '../services/blogAdDetector.js';
import { updateBlogReviewPlatformTypes, updateAllBlogReviewPlatformTypes } from '../utils/updatePlatformTypes.js';
import { isBrandingBlogPost, registerBrandingBlogPost } from '../services/brandingBlogService.js';
import { getBrandingPostSearchStatus } from '../services/naverSearchMonitor.js';

const logger = createLogger('ReviewController');

// 크롤링 진행 상태 추적 (메모리 기반)
const crawlingProgress = new Map();

// Socket.IO 인스턴스를 저장할 변수
let io = null;

// Socket.IO 인스턴스 설정
export function setSocketIO(socketIO) {
  io = socketIO;
}

/**
 * 블로그 리뷰 조회
 */
const getBlogReviews = async (req, res) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'getBlogReviews' });
  
  const { placeId } = req.params;
  
  const validationError = validateRequiredFields({ placeId }, ['placeId']);
  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.message
    });
  }

  try {
    // 자동 크롤링 비활성화 - 프론트엔드에서 명시적 크롤링으로 처리
    /*
    // 6시간 체크 후 필요시 자동 크롤링 실행
    try {
      const crawlResult = await autoCrawlIfNeeded(placeId, 'blog');
      if (crawlResult.crawled) {
        controllerLogger.info(`플레이스 ${placeId} 블로그 자동 크롤링 완료:`, crawlResult.result);
      } else if (crawlResult.skipped) {
        controllerLogger.debug(`플레이스 ${placeId} 블로그 크롤링 건너뜀 (6시간 미경과)`);
      }
    } catch (crawlError) {
      // 크롤링 실패해도 기존 리뷰는 조회할 수 있도록 로그만 남기고 계속 진행
      controllerLogger.warn(`플레이스 ${placeId} 블로그 자동 크롤링 실패:`, crawlError.message);
    }
    */

    const result = await handleDbOperation(async () => {
      // Review 테이블에서 블로그 리뷰 조회
      const reviews = await Review.findAll({
        where: { 
          place_id: placeId,
          review_type: 'blog'
        },
        order: [['review_date', 'DESC']],
        limit: 50 // 최신 50개만 조회
      });

      // 광고 분석이 안 된 리뷰들을 백그라운드로 분석
      const unanalyzedReviews = reviews.filter(review => review.ad_analyzed_at === null);
      if (unanalyzedReviews.length > 0) {
        controllerLogger.info(`${unanalyzedReviews.length}개 리뷰에 대해 광고 분석 시작`);
        
        // 백그라운드로 실행 (응답 지연 방지)
        setImmediate(async () => {
          for (const [index, review] of unanalyzedReviews.slice(0, 3).entries()) { // 최대 3개만 분석 (Rate limit 고려)
            try {
              const adResult = await detectBlogAd(review, io); // Socket.IO 인스턴스 전달
              await review.update({
                is_ad: adResult.isAd,
                ad_confidence: adResult.confidence,
                ad_analysis_result: adResult.analysis,
                ad_analyzed_at: new Date()
              });
              controllerLogger.info(`리뷰 ${review.id} Google Vision 광고 분석 완료: ${adResult.isAd ? '광고' : '일반'} (${adResult.confidence}%)`);
              
              // Socket.IO로 분석 완료 알림 (상세 정보 포함)
              if (io) {
                const socketData = {
                  placeId: String(placeId), // 문자열로 확실히 변환
                  reviewId: review.id,
                  isAd: adResult.isAd,
                  confidence: adResult.confidence,
                  finalReason: adResult.finalReason || '분석 완료',
                  title: review.title?.substring(0, 50),
                  timestamp: new Date().toISOString(),
                  analysisType: 'auto' // 자동 분석 표시
                };
                
                // 즉시 이벤트 발송
                io.emit('blogAdAnalysisComplete', socketData);
                
                // 추가로 특정 룸에도 발송 (placeId별로)
                io.to(`place-${placeId}`).emit('blogAdAnalysisComplete', socketData);
                
                controllerLogger.info(`Socket.IO 이벤트 발송 성공: blogAdAnalysisComplete`, {
                  placeId: String(placeId),
                  reviewId: review.id,
                  isAd: adResult.isAd,
                  confidence: adResult.confidence,
                  socketConnections: io.engine.clientsCount
                });
              } else {
                controllerLogger.warn('Socket.IO 인스턴스가 없어 실시간 업데이트를 보낼 수 없습니다');
              }
            } catch (error) {
              controllerLogger.error(`리뷰 ${review.id} 광고 분석 실패:`, error.message);
            }
          }
        });
      }

      // 리뷰 데이터를 프론트엔드 형식으로 변환
      const formattedReviews = await Promise.all(reviews.map(async (review) => {
        // 브랜딩 블로그 여부 확인
        const isBrandingPost = await isBrandingBlogPost(review);
        
        return {
          id: review.id,
          title: review.title || '제목 없음',
          content: review.content,
          author: review.author || '네이버 사용자',
          date: review.review_date || review.created_at,
          platform: 'blog',
          platform_type: review.platform_type, // 플랫폼 세부 타입 추가
          url: review.url,
          images: review.images || [],
          // 광고 분석 결과 추가
          isAd: review.is_ad,
          adConfidence: review.ad_confidence,
          adAnalyzedAt: review.ad_analyzed_at,
          // 답변 정보 추가 - 실제 답변과 AI 답변 구분
          has_owner_reply: review.has_owner_reply,
          owner_reply_content: review.has_owner_reply ? review.reply : null, // 실제 답변 내용
          reply: review.has_owner_reply ? null : review.reply, // AI 답변 (실제 답변이 있으면 숨김)
          replyDate: review.reply_date,
          replyGeneratedByAi: review.has_owner_reply ? false : review.reply_generated_by_ai,
          replyStatus: review.has_owner_reply ? null : review.reply_status,
          // 브랜딩 블로그 정보 추가
          isBrandingPost: isBrandingPost
        };
      }));

      // 총 개수 조회
      const totalCount = await Review.count({
        where: { 
          place_id: placeId,
          review_type: 'blog'
        }
      });

      // 플랫폼별 개수 조회 (null을 블로그로 간주)
      const cafeCount = await Review.count({
        where: { 
          place_id: placeId,
          review_type: 'blog',
          platform_type: 'cafe'
        }
      });

      const otherCount = await Review.count({
        where: { 
          place_id: placeId,
          review_type: 'blog',
          platform_type: 'other'
        }
      });

      // 블로그 개수 = 전체 - 카페 - 기타 (null은 블로그로 간주)
      const blogCount = totalCount - cafeCount - otherCount;

      return {
        reviews: formattedReviews,
        totalCount,
        platformCounts: {
          blog: blogCount,
          cafe: cafeCount,
          other: otherCount
        },
        naverUrl: `https://m.place.naver.com/place/${placeId}/review/visitor`
      };
    }, "블로그 리뷰 조회");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('블로그 리뷰 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '블로그 리뷰 조회 중 오류가 발생했습니다.'
    });
  }
};

/**
 * 영수증 리뷰 조회
 */
const getReceiptReviews = async (req, res) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'getReceiptReviews' });
  
  const { placeId } = req.params;
  
  const validationError = validateRequiredFields({ placeId }, ['placeId']);
  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.message
    });
  }

  try {
    controllerLogger.debug('영수증 리뷰 조회 시작');

    // 자동 크롤링 비활성화 - 프론트엔드에서 명시적 크롤링으로 처리
    /*
    // 6시간 체크 후 필요시 자동 크롤링 실행
    try {
      const crawlResult = await autoCrawlIfNeeded(placeId, 'receipt');
      if (crawlResult.crawled) {
        controllerLogger.info(`플레이스 ${placeId} 자동 크롤링 완료:`, crawlResult.result);
      } else if (crawlResult.skipped) {
        controllerLogger.debug(`플레이스 ${placeId} 크롤링 건너뜀 (6시간 미경과)`);
      }
    } catch (crawlError) {
      // 크롤링 실패해도 기존 리뷰는 조회할 수 있도록 로그만 남기고 계속 진행
      controllerLogger.warn(`플레이스 ${placeId} 자동 크롤링 실패:`, crawlError.message);
    }
    */

    const result = await handleDbOperation(async () => {
      // Review 테이블에서 영수증 리뷰 조회
      const reviews = await Review.findAll({
        where: { 
          place_id: placeId,
          review_type: 'receipt'
        },
        order: [['review_date', 'DESC']],
        limit: 50 // 최신 50개만 조회
      });

      // 리뷰 데이터를 프론트엔드 형식으로 변환
      const formattedReviews = reviews.map(review => ({
        id: review.id,
        title: review.title || '영수증 인증 리뷰',
        content: review.content || '영수증을 통해 실제 방문을 인증한 리뷰입니다.',
        author: review.author || '네이버 사용자',
        date: review.review_date || review.created_at,
        platform: 'receipt',
        url: review.url,
        images: review.images || [],
        // 답변 정보 추가 - 실제 답변과 AI 답변 구분
        has_owner_reply: review.has_owner_reply,
        owner_reply_content: review.has_owner_reply ? review.reply : null, // 실제 답변 내용
        reply: review.has_owner_reply ? null : review.reply, // AI 답변 (실제 답변이 있으면 숨김)
        reply_date: review.reply_date,
        reply_generated_by_ai: review.has_owner_reply ? false : review.reply_generated_by_ai,
        reply_status: review.has_owner_reply ? null : review.reply_status
      }));

      // 총 개수 조회
      const totalCount = await Review.count({
        where: { 
          place_id: placeId,
          review_type: 'receipt'
        }
      });

      // 실제 사업자 답변이 없는 리뷰 수 조회 (AI 답변은 답변으로 인정하지 않음)
      const unansweredCount = await Review.count({
        where: { 
          place_id: placeId,
          review_type: 'receipt',
          has_owner_reply: false // AI 답변은 답변으로 인정하지 않음
        }
      });

      return {
        reviews: formattedReviews,
        totalCount,
        unansweredCount,
        naverUrl: `https://m.place.naver.com/place/${placeId}/review/ugc`
      };
    }, "영수증 리뷰 조회");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('영수증 리뷰 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '영수증 리뷰 조회 중 오류가 발생했습니다.'
    });
  }
};

/**
 * 네이버 플레이스 정보 조회
 */
const getNaverPlaceInfo = async (req, res) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'getNaverPlaceInfo' });
  
  const { placeId } = req.params;
  
  const validationError = validateRequiredFields({ placeId }, ['placeId']);
  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.message
    });
  }

  try {
    const result = await handleDbOperation(async () => {
      const { default: Place } = await import('../models/Place.js');
      
      // Place 테이블에서 업체 정보 조회
      const place = await Place.findOne({
        where: { place_id: placeId },
        attributes: ['place_name']
      });

      if (!place) {
        throw new Error('업체 정보를 찾을 수 없습니다.');
      }

      return {
        naverUrl: `https://m.place.naver.com/place/${placeId}`,
        placeName: place.place_name
      };
    }, "네이버 플레이스 정보 조회");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('네이버 플레이스 정보 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '네이버 플레이스 정보 조회 중 오류가 발생했습니다.'
    });
  }
};

/**
 * 네이버 리뷰 크롤링
 */
const crawlReviews = async (req, res) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'crawlReviews' });
  
  const { placeId } = req.params;
  const { sortType = 'recommend', maxPages = 3 } = req.body;
  
  const validationError = validateRequiredFields({ placeId }, ['placeId']);
  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.message
    });
  }

  // 이미 해당 placeId에 대해 크롤링이 진행 중인지 확인
  if (crawlingProgress.has(placeId)) {
    const crawlInfo = crawlingProgress.get(placeId);
    const elapsed = new Date() - crawlInfo.startTime;
    
    // 30분 이상 경과된 크롤링은 스택 상태로 간주하고 정리
    if (elapsed > 30 * 60 * 1000) { // 30분
      controllerLogger.warn(`크롤링 타임아웃으로 상태 정리: ${placeId} (${Math.round(elapsed / 1000)}초 경과)`);
      crawlingProgress.delete(placeId);
    } else {
      return res.status(409).json({
        success: false,
        message: '해당 업체의 리뷰 크롤링이 이미 진행 중입니다. 잠시 후 다시 시도해주세요.',
        elapsedTime: Math.round(elapsed / 1000) + '초'
      });
    }
  }

  try {
    // 크롤링 시작 상태 설정
    crawlingProgress.set(placeId, { startTime: new Date(), status: 'running' });
    
    // 크롤링 시작 알림
    if (io) {
      io.emit('crawlingProgress', {
        placeId,
        progress: 0,
        message: '크롤링을 시작합니다...',
        status: 'started'
      });
    }
    
    const result = await handleDbOperation(async () => {
      const crawler = new NaverReviewCrawler();
      
      controllerLogger.info(`리뷰 크롤링 시작: ${placeId}`, { 
        sortType, 
        maxPages 
      });
      
      // 진행률 콜백 함수 정의
      const progressCallback = (progress, message, stage) => {
        if (io) {
          io.emit('crawlingProgress', {
            placeId,
            progress,
            message,
            stage,
            status: progress >= 100 ? 'completed' : 'crawling'
          });
        }
      };
      
      // 초기 진행률
      progressCallback(0, '크롤링 준비 중...', 'preparing');
      
      const crawlResult = await crawler.crawlAndSaveReviews(placeId, {
        sortType,
        maxPages: parseInt(maxPages),
        progressCallback // 진행률 콜백 전달
      });
      
      // 완료 알림
      progressCallback(100, `크롤링 완료: ${crawlResult.saved}개 리뷰 저장`, 'completed');
      
      controllerLogger.info(`리뷰 크롤링 완료: ${crawlResult.saved}/${crawlResult.total}`, {
        placeId,
        total: crawlResult.total,
        saved: crawlResult.saved
      });
      
      return {
        message: '리뷰 크롤링이 완료되었습니다.',
        totalCrawled: crawlResult.total,
        totalSaved: crawlResult.saved,
        reviews: crawlResult.reviews
      };
    }, "네이버 리뷰 크롤링");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('리뷰 크롤링 오류:', error);
    
    // 오류 알림
    if (io) {
      io.emit('crawlingProgress', {
        placeId,
        progress: 0,
        message: '크롤링 중 오류가 발생했습니다.',
        status: 'error',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: '리뷰 크롤링 중 오류가 발생했습니다.',
      error: error.message
    });
  } finally {
    // 크롤링 상태 정리
    crawlingProgress.delete(placeId);
  }
};

/**
 * 블로그 리뷰 플랫폼 타입 일괄 업데이트 (관리자용)
 */
const updatePlatformTypes = async (req, res) => {
  const { handleDbOperation, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'updatePlatformTypes' });

  const { all = false, limit = 100 } = req.query;

  try {
    controllerLogger.info(`플랫폼 타입 업데이트 시작 - all: ${all}, limit: ${limit}`);
    
    let results;
    if (all === 'true') {
      results = await updateAllBlogReviewPlatformTypes();
    } else {
      results = await updateBlogReviewPlatformTypes(parseInt(limit));
    }
    
    res.json({
      success: true,
      message: '플랫폼 타입 업데이트 완료',
      data: results
    });
    
  } catch (error) {
    controllerLogger.error('플랫폼 타입 업데이트 오류:', error);
    res.status(500).json({
      success: false,
      message: '플랫폼 타입 업데이트 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

/**
 * 크롤링 상태 확인 및 정리 (관리자용)
 */
const getCrawlingStatus = async (req, res) => {
  const { handleDbOperation, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'getCrawlingStatus' });

  try {
    const status = [];
    for (const [placeId, info] of crawlingProgress.entries()) {
      const duration = new Date() - info.startTime;
      status.push({
        placeId,
        status: info.status,
        startTime: info.startTime,
        duration: Math.round(duration / 1000) + '초'
      });
    }

    res.json({
      success: true,
      data: {
        total: crawlingProgress.size,
        crawling: status
      }
    });
  } catch (error) {
    controllerLogger.error('크롤링 상태 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '크롤링 상태 조회 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

/**
 * 크롤링 상태 강제 정리 (관리자용)
 */
const clearCrawlingStatus = async (req, res) => {
  const { logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'clearCrawlingStatus' });

  const { placeId } = req.params;

  try {
    if (placeId) {
      // 특정 placeId 정리
      if (crawlingProgress.has(placeId)) {
        crawlingProgress.delete(placeId);
        controllerLogger.info(`크롤링 상태 정리: ${placeId}`);
        res.json({
          success: true,
          message: `${placeId} 크롤링 상태가 정리되었습니다.`
        });
      } else {
        res.json({
          success: true,
          message: `${placeId}는 크롤링 중이 아닙니다.`
        });
      }
    } else {
      // 모든 상태 정리
      const count = crawlingProgress.size;
      crawlingProgress.clear();
      controllerLogger.info(`모든 크롤링 상태 정리: ${count}개`);
      res.json({
        success: true,
        message: `모든 크롤링 상태가 정리되었습니다. (${count}개)`
      });
    }
  } catch (error) {
    controllerLogger.error('크롤링 상태 정리 오류:', error);
    res.status(500).json({
      success: false,
      message: '크롤링 상태 정리 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

/**
 * 특정 리뷰의 광고 분석 재실행 (관리자용)
 */
const reanalyzeReviewAd = async (req, res) => {
  const { handleDbOperation, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'reanalyzeReviewAd' });

  const { reviewId } = req.params;

  try {
    const result = await handleDbOperation(async () => {
      const review = await Review.findByPk(reviewId);
      
      if (!review) {
        throw new Error('리뷰를 찾을 수 없습니다.');
      }

      controllerLogger.info(`리뷰 ${reviewId} Google Vision 광고 재분석 시작`);
      
      // 광고 분석 실행
      const adResult = await detectBlogAd(review, io);
      
      // 결과 저장
      await review.update({
        is_ad: adResult.isAd,
        ad_confidence: adResult.confidence,
        ad_analysis_result: adResult.analysis,
        ad_analyzed_at: new Date()
      });

      controllerLogger.info(`리뷰 ${reviewId} 광고 재분석 완료:`, {
        isAd: adResult.isAd,
        confidence: adResult.confidence,
        finalReason: adResult.finalReason
      });

      // Socket.IO로 실시간 업데이트 알림
      if (io) {
        const socketData = {
          reviewId: review.id,
          placeId: String(review.place_id), // 문자열로 확실히 변환
          isAd: adResult.isAd,
          confidence: adResult.confidence,
          finalReason: adResult.finalReason,
          title: review.title?.substring(0, 50),
          timestamp: new Date().toISOString(),
          analysisType: 'manual' // 수동 재분석 표시
        };
        
        // 즉시 이벤트 발송
        io.emit('blogAdAnalysisComplete', socketData);
        
        // 추가로 특정 룸에도 발송
        io.to(`place-${review.place_id}`).emit('blogAdAnalysisComplete', socketData);
        
        controllerLogger.info(`Socket.IO 이벤트 발송 성공 (수동 재분석): blogAdAnalysisComplete`, {
          placeId: String(review.place_id),
          reviewId: review.id,
          isAd: adResult.isAd,
          confidence: adResult.confidence,
          socketConnections: io.engine.clientsCount
        });
      } else {
        controllerLogger.warn('Socket.IO 인스턴스가 없어 실시간 업데이트를 보낼 수 없습니다 (재분석)');
      }

      return {
        reviewId: review.id,
        title: review.title,
        isAd: adResult.isAd,
        confidence: adResult.confidence,
        previousResult: {
          isAd: review.is_ad,
          confidence: review.ad_confidence
        },
        finalReason: adResult.finalReason
      };
    }, "리뷰 광고 재분석");

    res.json({
      success: true,
      message: '리뷰 광고 분석이 완료되었습니다.',
      data: result
    });

  } catch (error) {
    controllerLogger.error('리뷰 광고 재분석 오류:', error);
    res.status(500).json({
      success: false,
      message: '리뷰 광고 재분석 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

/**
 * 특정 업체의 모든 리뷰 광고 분석 재실행 (관리자용)
 */
const reanalyzeAllReviewsAd = async (req, res) => {
  const { handleDbOperation, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'reanalyzeAllReviewsAd' });

  const { placeId } = req.params;
  const { limit = 50, onlyUnchecked = false } = req.query;

  try {
    const result = await handleDbOperation(async () => {
      const whereCondition = {
        place_id: placeId,
        review_type: 'blog'
      };

      // onlyUnchecked가 true면 분석되지 않은 리뷰만
      if (onlyUnchecked === 'true') {
        whereCondition.ad_analyzed_at = null;
      }

      const reviews = await Review.findAll({
        where: whereCondition,
        order: [['created_at', 'DESC']],
        limit: parseInt(limit)
      });

      if (reviews.length === 0) {
        return {
          message: '분석할 리뷰가 없습니다.',
          processed: 0,
          results: []
        };
      }

      controllerLogger.info(`${reviews.length}개 리뷰 Google Vision 광고 재분석 시작`);

      const results = [];
      let processed = 0;

      // 분석 시작 시 전체 진행률을 0으로 알림
      if (io) {
        io.to(`place-${placeId}`).emit('adAnalysisStarted', {
          placeId,
          total: reviews.length,
          reviews: reviews.map(r => ({ id: r.id, title: r.title }))
        });
      }

      for (const [index, review] of reviews.entries()) {
        try {
          // 개별 리뷰 분석 시작 알림
          if (io) {
            io.to(`place-${placeId}`).emit('reviewAnalysisStarted', {
              reviewId: review.id,
              placeId,
              title: review.title
            });
          }

          const adResult = await detectBlogAd(review, io);
          
          await review.update({
            is_ad: adResult.isAd,
            ad_confidence: adResult.confidence,
            ad_analysis_result: adResult.analysis,
            ad_analyzed_at: new Date()
          });

          processed++;

          // Socket.IO로 개별 리뷰 분석 완료 알림
          if (io) {
            const socketData = {
              reviewId: review.id,
              placeId: String(review.place_id),
              isAd: adResult.isAd,
              confidence: adResult.confidence,
              finalReason: adResult.finalReason,
              title: review.title?.substring(0, 50),
              timestamp: new Date().toISOString(),
              analysisType: 'bulk',
              progress: {
                current: processed,
                total: reviews.length
              }
            };
            
            // 개별 리뷰 분석 완료 이벤트
            io.to(`place-${placeId}`).emit('reviewAnalysisComplete', socketData);
            
            controllerLogger.info(`Socket.IO 이벤트 발송 성공 (일괄 재분석 ${processed}/${reviews.length}): reviewAnalysisComplete`, {
              placeId: String(review.place_id),
              reviewId: review.id,
              isAd: adResult.isAd,
              confidence: adResult.confidence
            });
          }

          results.push({
            reviewId: review.id,
            title: review.title?.substring(0, 50) + '...',
            isAd: adResult.isAd,
            confidence: adResult.confidence,
            finalReason: adResult.finalReason,
            analysis: {
              textAnalysis: adResult.analysis?.text ? {
                isAd: adResult.analysis.text.isAd,
                confidence: adResult.analysis.text.confidence,
                detectedKeywords: adResult.analysis.text.detectedKeywords || [],
                reason: adResult.analysis.text.reason
              } : null,
              imageAnalysis: adResult.analysis?.images?.map((img, idx) => ({
                imageIndex: img.imageIndex || idx,
                isAd: img.isAd,
                confidence: img.confidence,
                detectedKeywords: img.detectedKeywords || [],
                reason: img.reason
              })) || [],
              summary: adResult.analysis?.summary || {
                textScore: adResult.analysis?.text?.confidence || 0,
                imageScore: 0,
                bestImageIndex: -1,
                detectionDetails: []
              }
            }
          });

        } catch (error) {
          controllerLogger.error(`리뷰 ${review.id} 광고 재분석 실패:`, error.message);
          
          // 분석 실패 시에도 Socket.IO로 알림
          if (io) {
            io.to(`place-${placeId}`).emit('reviewAnalysisError', {
              reviewId: review.id,
              placeId,
              error: error.message,
              title: review.title?.substring(0, 50)
            });
          }
          
          results.push({
            reviewId: review.id,
            title: review.title?.substring(0, 30) + '...',
            error: error.message
          });
        }
      }

      // 전체 분석 완료 알림
      if (io) {
        io.to(`place-${placeId}`).emit('adAnalysisCompleted', {
          placeId,
          processed,
          total: reviews.length,
          message: `${processed}개 리뷰 광고 재분석 완료`
        });
      }

      controllerLogger.info(`광고 재분석 완료: ${processed}/${reviews.length}`);

      return {
        message: `${processed}개 리뷰 광고 재분석 완료`,
        processed,
        total: reviews.length,
        results
      };
    }, "전체 리뷰 광고 재분석");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('전체 리뷰 광고 재분석 오류:', error);
    res.status(500).json({
      success: false,
      message: '전체 리뷰 광고 재분석 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

/**
 * 선택된 리뷰들의 광고 분석 재실행 (관리자용)
 */
const analyzeSelectedReviews = async (req, res) => {
  const { handleDbOperation, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'analyzeSelectedReviews' });

  const { placeId } = req.params;
  const { reviewIds } = req.body;

  try {
    const result = await handleDbOperation(async () => {
      if (!reviewIds || !Array.isArray(reviewIds) || reviewIds.length === 0) {
        throw new Error('분석할 리뷰 ID를 선택해주세요.');
      }

      const reviews = await Review.findAll({
        where: {
          id: reviewIds,
          place_id: placeId,
          review_type: 'blog'
        }
      });

      if (reviews.length === 0) {
        return {
          message: '선택된 리뷰가 없습니다.',
          processed: 0,
          total: 0,
          results: []
        };
      }

      controllerLogger.info(`${reviews.length}개 선택된 리뷰 Google Vision 광고 분석 시작`);

      const results = [];
      let processed = 0;

      // 분석 시작 시 전체 진행률을 0으로 알림
      if (io) {
        io.to(`place-${placeId}`).emit('adAnalysisStarted', {
          placeId,
          total: reviews.length,
          reviews: reviews.map(r => ({ id: r.id, title: r.title })),
          analysisType: 'selected'
        });
      }

      for (const [index, review] of reviews.entries()) {
        try {
          // 개별 리뷰 분석 시작 알림
          if (io) {
            io.to(`place-${placeId}`).emit('reviewAnalysisStarted', {
              reviewId: review.id,
              placeId,
              title: review.title,
              analysisType: 'selected'
            });
          }

          const adResult = await detectBlogAd(review, io);
          
          await review.update({
            is_ad: adResult.isAd,
            ad_confidence: adResult.confidence,
            ad_analysis_result: adResult.analysis,
            ad_analyzed_at: new Date()
          });

          processed++;
          
          // Socket.IO로 개별 리뷰 분석 완료 알림
          if (io) {
            const socketData = {
              reviewId: review.id,
              placeId: String(review.place_id),
              isAd: adResult.isAd,
              confidence: adResult.confidence,
              finalReason: adResult.finalReason,
              title: review.title?.substring(0, 50),
              timestamp: new Date().toISOString(),
              analysisType: 'selected',
              progress: {
                current: processed,
                total: reviews.length
              }
            };
            
            // 개별 리뷰 분석 완료 이벤트
            io.to(`place-${placeId}`).emit('reviewAnalysisComplete', socketData);
            
            controllerLogger.info(`Socket.IO 이벤트 발송 성공 (선택 리뷰 분석 ${processed}/${reviews.length}): reviewAnalysisComplete`, {
              placeId: String(review.place_id),
              reviewId: review.id,
              isAd: adResult.isAd,
              confidence: adResult.confidence
            });
          }

          results.push({
            reviewId: review.id,
            title: review.title?.substring(0, 50) + '...',
            isAd: adResult.isAd,
            confidence: adResult.confidence,
            finalReason: adResult.finalReason,
            analysis: {
              textAnalysis: adResult.analysis?.text ? {
                isAd: adResult.analysis.text.isAd,
                confidence: adResult.analysis.text.confidence,
                detectedKeywords: adResult.analysis.text.detectedKeywords || [],
                reason: adResult.analysis.text.reason
              } : null,
              imageAnalysis: adResult.analysis?.images?.map(img => ({
                imageIndex: img.imageIndex,
                isAd: img.isAd,
                confidence: img.confidence,
                detectedKeywords: img.detectedKeywords || [],
                reason: img.reason
              })) || [],
              summary: adResult.analysis?.summary || {
                textScore: 0,
                imageScore: 0,
                bestImageIndex: -1,
                detectionDetails: []
              }
            },
            error: null
          });

          controllerLogger.info(`리뷰 ${review.id} 분석 완료: ${adResult.isAd ? '광고' : '일반'} (${adResult.confidence}%)`);
        } catch (analysisError) {
          controllerLogger.error(`리뷰 ${review.id} 분석 실패:`, analysisError);
          
          // 분석 실패 시에도 Socket.IO로 알림
          if (io) {
            io.to(`place-${placeId}`).emit('reviewAnalysisError', {
              reviewId: review.id,
              placeId,
              error: analysisError.message,
              title: review.title?.substring(0, 50),
              analysisType: 'selected'
            });
          }
          
          results.push({
            reviewId: review.id,
            title: review.title?.substring(0, 50) + '...',
            isAd: false,
            confidence: 0,
            finalReason: '분석 중 오류 발생',
            analysis: null,
            error: analysisError.message
          });
        }
      }

      // 전체 분석 완료 알림
      if (io) {
        io.to(`place-${placeId}`).emit('adAnalysisCompleted', {
          placeId,
          processed,
          total: reviews.length,
          message: `${processed}개 리뷰 광고 분석 완료`,
          analysisType: 'selected'
        });
      }

      return {
        message: `${processed}개 리뷰 분석 완료`,
        processed,
        total: reviews.length,
        results
      };
    }, "선택된 리뷰 광고 분석");

    return res.status(200).json({
      success: true,
      message: '선택된 리뷰 광고 분석이 완료되었습니다.',
      data: result
    });

  } catch (error) {
    controllerLogger.error('선택된 리뷰 광고 분석 실패:', error);
    return res.status(500).json({
      success: false,
      message: error.message || '선택된 리뷰 광고 분석 중 오류가 발생했습니다.'
    });
  }
};

/**
 * 모든 등록된 업체의 리뷰 자동 크롤링 (백그라운드)
 */
const crawlAllBusinessReviews = async (req, res) => {
  const { handleDbOperation, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'crawlAllBusinessReviews' });
  
  const userId = req.user?.id;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: '인증이 필요합니다'
    });
  }

  try {
    // 사용자의 모든 등록된 업체 조회 (Place 모델 사용)
    const { Place } = await import('../models/index.js');
    const businesses = await Place.findAll({
      where: { user_id: userId },
      attributes: ['place_id', 'place_name']
    });

    if (businesses.length === 0) {
      return res.json({
        success: true,
        message: '등록된 업체가 없습니다',
        data: { processedCount: 0, businesses: [] }
      });
    }

    controllerLogger.info(`사용자 ${userId}의 ${businesses.length}개 업체 백그라운드 크롤링 시작`);

    // 백그라운드에서 각 업체별로 크롤링 실행 (응답은 즉시 반환)
    setImmediate(async () => {
      const results = [];
      
      for (const business of businesses) {
        try {
          const crawlResult = await autoCrawlIfNeeded(business.place_id, 'blog');
          results.push({
            placeId: business.place_id,
            placeName: business.place_name,
            success: true,
            crawled: crawlResult.crawled,
            message: crawlResult.crawled ? '크롤링 완료' : '6시간 미경과로 건너뜀'
          });
          
          if (crawlResult.crawled) {
            controllerLogger.info(`업체 ${business.place_name}(${business.place_id}) 백그라운드 크롤링 완료`);
          }
        } catch (error) {
          controllerLogger.error(`업체 ${business.place_name}(${business.place_id}) 백그라운드 크롤링 실패:`, error.message);
          results.push({
            placeId: business.place_id,
            placeName: business.place_name,
            success: false,
            message: error.message
          });
        }
        
        // 각 업체 간 1초 딜레이 (서버 부하 방지)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      controllerLogger.info(`사용자 ${userId}의 모든 업체 백그라운드 크롤링 완료:`, {
        total: businesses.length,
        success: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      });
    });

    // 즉시 응답 반환 (백그라운드 처리)
    res.json({
      success: true,
      message: `${businesses.length}개 업체의 리뷰 크롤링을 백그라운드에서 시작했습니다`,
      data: {
        processedCount: businesses.length,
        businesses: businesses.map(b => ({
          placeId: b.place_id,
          placeName: b.place_name
        }))
      }
    });

  } catch (error) {
    controllerLogger.error('모든 업체 크롤링 실패:', error);
    res.status(500).json({
      success: false,
      message: '모든 업체 크롤링 중 오류가 발생했습니다',
      error: error.message
    });
  }
};

/**
 * 대시보드용 리뷰 현황 조회 (블로그/영수증 분리)
 */
const getDashboardReviewStatus = async (req, res) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'getDashboardReviewStatus' });
  
  const { placeId } = req.params;
  
  const validationError = validateRequiredFields({ placeId }, ['placeId']);
  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.message
    });
  }

  try {
    const result = await handleDbOperation(async () => {
      const { default: Place } = await import('../models/Place.js');
      
      // Place 정보 조회
      const place = await Place.findOne({
        where: { place_id: placeId },
        attributes: ['place_name']
      });

      if (!place) {
        throw new Error('업체 정보를 찾을 수 없습니다.');
      }

      // 블로그 리뷰 현황
      const blogReviewCount = await Review.count({
        where: { 
          place_id: placeId,
          review_type: 'blog'
        }
      });

      // 영수증 리뷰 현황
      const receiptReviewCount = await Review.count({
        where: { 
          place_id: placeId,
          review_type: 'receipt'
        }
      });

      // 최신 블로그 리뷰의 크롤링 시간 (created_at을 크롤링 시간으로 사용)
      const latestBlogReview = await Review.findOne({
        where: { 
          place_id: placeId,
          review_type: 'blog'
        },
        order: [['created_at', 'DESC']],
        attributes: ['created_at']
      });

      // 최신 영수증 리뷰의 크롤링 시간
      const latestReceiptReview = await Review.findOne({
        where: { 
          place_id: placeId,
          review_type: 'receipt'
        },
        order: [['created_at', 'DESC']],
        attributes: ['created_at']
      });

      // 최근 2주 블로그 리뷰 수
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      
      const recent2WeeksBlog = await Review.count({
        where: { 
          place_id: placeId,
          review_type: 'blog',
          review_date: {
            [Review.sequelize.Sequelize.Op.gte]: twoWeeksAgo
          }
        }
      });

      // 최근 2주 영수증 리뷰 수
      const recent2WeeksReceipt = await Review.count({
        where: { 
          place_id: placeId,
          review_type: 'receipt',
          review_date: {
            [Review.sequelize.Sequelize.Op.gte]: twoWeeksAgo
          }
        }
      });

      // 실제 사업자 답변이 없는 리뷰 수 (AI 답변은 답변으로 인정하지 않음)
      const unansweredCount = await Review.count({
        where: { 
          place_id: placeId,
          has_owner_reply: false // 실제 사업자 답변 기준
        }
      });

      // 답변률 계산
      const totalReviews = blogReviewCount + receiptReviewCount;
      const answeredCount = totalReviews - unansweredCount;
      const replyRate = totalReviews > 0 ? Math.round((answeredCount / totalReviews) * 100) : 0;

      return {
        placeName: place.place_name,
        totalReviews: totalReviews,
        blogReviews: {
          count: blogReviewCount,
          recent2Weeks: recent2WeeksBlog,
          lastCrawledAt: latestBlogReview?.created_at || null
        },
        receiptReviews: {
          count: receiptReviewCount,
          recent2Weeks: recent2WeeksReceipt,
          lastCrawledAt: latestReceiptReview?.created_at || null
        },
        replyRate: replyRate,
        unansweredCount: unansweredCount,
        recent2WeeksBlog: recent2WeeksBlog,
        recent2WeeksReceipt: recent2WeeksReceipt
      };
    }, "대시보드 리뷰 현황 조회");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('대시보드 리뷰 현황 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '대시보드 리뷰 현황 조회 중 오류가 발생했습니다.'
    });
  }
};

/**
 * 크롤링 필요 여부 확인
 */
const checkCrawlingNeeded = async (req, res) => {
  const { handleDbOperation, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'checkCrawlingNeeded' });
  
  const { placeId } = req.params;
  
  try {
    const result = await handleDbOperation(async () => {
      const { shouldCrawl, getLastCrawlTime } = await import('../utils/reviewCrawlTracker.js');
      
      const needsCrawl = await shouldCrawl(placeId);
      const lastCrawlTime = await getLastCrawlTime(placeId);
      
      let hoursSinceLastCrawl = null;
      if (lastCrawlTime) {
        const now = new Date();
        const timeDiff = now.getTime() - lastCrawlTime.getTime();
        hoursSinceLastCrawl = timeDiff / (1000 * 60 * 60);
      }
      
      return {
        needsCrawl,
        lastCrawlTime,
        hoursSinceLastCrawl: hoursSinceLastCrawl ? Math.round(hoursSinceLastCrawl * 10) / 10 : null
      };
    }, "크롤링 필요 여부 확인");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('크롤링 필요 여부 확인 오류:', error);
    res.status(500).json({
      success: false,
      message: '크롤링 필요 여부 확인 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

/**
 * 브랜딩 블로그 검색 상태 조회
 */
const getBrandingBlogStatus = async (req, res) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewController', actionName: 'getBrandingBlogStatus' });
  
  const { placeId } = req.params;
  
  const validationError = validateRequiredFields({ placeId }, ['placeId']);
  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.message
    });
  }

  try {
    const result = await handleDbOperation(async () => {
      const searchStatus = await getBrandingPostSearchStatus(placeId);
      return {
        posts: searchStatus,
        totalPosts: searchStatus.length,
        pendingPosts: searchStatus.filter(post => post.status === 'pending').length,
        foundPosts: searchStatus.filter(post => post.status === 'found').length,
        missedPosts: searchStatus.filter(post => post.status === 'missed').length
      };
    }, "브랜딩 블로그 검색 상태 조회");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('브랜딩 블로그 검색 상태 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '브랜딩 블로그 검색 상태 조회 중 오류가 발생했습니다.'
    });
  }
};

export {
  getBlogReviews,
  getReceiptReviews,
  getNaverPlaceInfo,
  crawlReviews,
  updatePlatformTypes,
  getCrawlingStatus,
  clearCrawlingStatus,
  reanalyzeReviewAd,
  reanalyzeAllReviewsAd,
  analyzeSelectedReviews,
  crawlAllBusinessReviews,
  getDashboardReviewStatus,
  checkCrawlingNeeded,
  getBrandingBlogStatus
};
