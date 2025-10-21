import express from 'express';
import { getBlogReviews, getReceiptReviews, getNaverPlaceInfo, crawlReviews, updatePlatformTypes, getCrawlingStatus, clearCrawlingStatus, reanalyzeReviewAd, reanalyzeAllReviewsAd, analyzeSelectedReviews, crawlAllBusinessReviews, getDashboardReviewStatus, checkCrawlingNeeded, getBrandingBlogStatus } from '../controllers/reviewController.js';
import { authenticateJWT } from '../middlewares/auth.js';

const router = express.Router();

// 테스트용 - 인증 없이 접근 가능한 라우트
router.get('/test/blog/:placeId', getBlogReviews);
router.get('/test/receipt/:placeId', getReceiptReviews);

// 블로그 리뷰 조회
router.get('/blog/:placeId', authenticateJWT, getBlogReviews);

// 영수증 리뷰 조회  
router.get('/receipt/:placeId', authenticateJWT, getReceiptReviews);

// 크롤링 필요 여부 확인
router.get('/check-crawling-needed/:placeId', authenticateJWT, checkCrawlingNeeded);

// 네이버 리뷰 크롤링
router.post('/crawl/:placeId', authenticateJWT, crawlReviews);

// 플랫폼 타입 일괄 업데이트 (관리자용)
router.post('/admin/update-platform-types', authenticateJWT, updatePlatformTypes);

// 크롤링 상태 관리 (관리자용)
router.get('/admin/crawling-status', authenticateJWT, getCrawlingStatus);
router.delete('/admin/crawling-status/:placeId?', authenticateJWT, clearCrawlingStatus);

// 광고 분석 재실행 (관리자용)
router.post('/admin/reanalyze-ad/:reviewId', authenticateJWT, reanalyzeReviewAd);
router.post('/admin/reanalyze-all-ads/:placeId', authenticateJWT, reanalyzeAllReviewsAd);
router.post('/admin/analyze-selected-reviews/:placeId', authenticateJWT, analyzeSelectedReviews);

// 대시보드용 리뷰 현황 조회 (블로그/영수증 분리)
router.get('/dashboard-status/:placeId', authenticateJWT, getDashboardReviewStatus);

// 모든 업체 백그라운드 크롤링
router.post('/admin/crawl-all-businesses', authenticateJWT, crawlAllBusinessReviews);

// 브랜딩 블로그 검색 상태 조회
router.get('/branding-blog-status/:placeId', authenticateJWT, getBrandingBlogStatus);

export default router;
