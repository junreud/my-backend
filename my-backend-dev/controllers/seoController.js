import { createLogger } from '../lib/logger.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';
import Place from '../models/Place.js';
import PlaceDetailResult from '../models/PlaceDetailResult.js';
import SEOAnalysisResult from '../models/SEOAnalysisResult.js';
import Review from '../models/Review.js';
import { Op } from 'sequelize';
import puppeteer from 'puppeteer';

const logger = createLogger('SEOController');

/**
 * SEO 분석을 위한 네이버 플레이스 크롤링
 */
export const analyzeSEO = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({ 
    controllerName: 'SEOController', 
    actionName: 'analyzeSEO' 
  });
  
  try {
    const { placeId } = req.body;
    
    // 사용자 정보 디버깅
    controllerLogger.info(`사용자 정보 전체:`, req.user);
    
    const userId = req.user?.id || req.user?.userId;
    controllerLogger.info(`추출된 userId: ${userId}`);
    
    const validationError = validateRequiredFields(req.body, ['placeId']);
    if (validationError) {
      const error = new Error(validationError.message);
      error.statusCode = 400;
      throw error;
    }
    
    controllerLogger.info(`SEO 분석 시작 - placeId: ${placeId}, userId: ${userId}`);
    
    // 업체 정보 조회
    const place = await handleDbOperation(async () => {
      return Place.findOne({
        where: { 
          place_id: placeId,
          user_id: userId // 사용자의 업체인지 확인
        },
        raw: true
      });
    }, "업체 정보 조회");
    
    if (!place) {
      const error = new Error('업체 정보를 찾을 수 없거나 접근 권한이 없습니다.');
      error.statusCode = 404;
      throw error;
    }
    
    // 대표키워드 조회 - place_id 매칭 문제 해결
    const placeDetailResult = await handleDbOperation(async () => {
      // 디버깅: Place 정보 확인
      controllerLogger.info(`Place 정보: ID=${place.id}, place_id=${place.place_id}, place_name=${place.place_name}`);
      
      // 1차: place_id (문자열)로 직접 매칭 시도
      let result = await PlaceDetailResult.findOne({
        where: { 
          place_id: placeId // 문자열 place_id로 직접 매칭
        },
        attributes: ['place_id', 'keywordList', 'last_crawled_at', 'created_at'],
        order: [['last_crawled_at', 'DESC']],
        raw: true
      });
      
      controllerLogger.info(`1차 매칭 결과 (place_id=${placeId}):`, result);
      
      // 2차: 내부 ID로 매칭 시도
      if (!result) {
        result = await PlaceDetailResult.findOne({
          where: { 
            place_id: place.id // Place 테이블의 내부 ID 사용
          },
          attributes: ['place_id', 'keywordList', 'last_crawled_at', 'created_at'],
          order: [['last_crawled_at', 'DESC']],
          raw: true
        });
        
        controllerLogger.info(`2차 매칭 결과 (place.id=${place.id}):`, result);
      }
      
      // 3차: 최근 PlaceDetailResult 전체 확인 (디버깅용)
      const allResults = await PlaceDetailResult.findAll({
        attributes: ['place_id', 'keywordList', 'last_crawled_at'],
        limit: 10,
        order: [['last_crawled_at', 'DESC']],
        raw: true
      });
      
      controllerLogger.info(`최근 PlaceDetailResult 10개:`, allResults);

      // 키워드가 있는 결과 찾기
      if (!result || !result.keywordList || result.keywordList.trim() === '' || result.keywordList === 'null') {
        // place_id로 키워드가 있는 데이터 찾기
        result = await PlaceDetailResult.findOne({
          where: { 
            place_id: placeId,
            keywordList: {
              [Op.and]: [
                { [Op.ne]: null },
                { [Op.ne]: '' },
                { [Op.ne]: 'null' },
                { [Op.ne]: '[]' }
              ]
            }
          },
          attributes: ['place_id', 'keywordList', 'last_crawled_at', 'created_at'],
          order: [['last_crawled_at', 'DESC']],
          raw: true
        });
        
        controllerLogger.info(`키워드가 있는 결과 (place_id=${placeId}):`, result);
        
        // 내부 ID로도 시도
        if (!result) {
          result = await PlaceDetailResult.findOne({
            where: { 
              place_id: place.id,
              keywordList: {
                [Op.and]: [
                  { [Op.ne]: null },
                  { [Op.ne]: '' },
                  { [Op.ne]: 'null' },
                  { [Op.ne]: '[]' }
                ]
              }
            },
            attributes: ['place_id', 'keywordList', 'last_crawled_at', 'created_at'],
            order: [['last_crawled_at', 'DESC']],
            raw: true
          });
          
          controllerLogger.info(`키워드가 있는 결과 (place.id=${place.id}):`, result);
        }
      }

      return result;
    }, "대표키워드 조회");

    // keywordList 파싱 및 정제 로직 개선
    let representativeKeywords = null;
    if (placeDetailResult?.keywordList) {
      const rawKeywords = placeDetailResult.keywordList.trim();
      controllerLogger.info(`키워드 원본 데이터: "${rawKeywords}"`);
      
      try {
        // 1차: JSON 배열 형태 파싱 시도
        if (rawKeywords.startsWith('[') && rawKeywords.endsWith(']')) {
          representativeKeywords = JSON.parse(rawKeywords);
          controllerLogger.info(`JSON 배열 파싱 성공:`, representativeKeywords);
        }
        // 2차: JSON 객체 형태 파싱 시도
        else if (rawKeywords.startsWith('{') && rawKeywords.endsWith('}')) {
          const parsed = JSON.parse(rawKeywords);
          // 객체에서 키워드 배열 추출
          representativeKeywords = parsed.keywords || parsed.keywordList || parsed.list || Object.values(parsed);
          controllerLogger.info(`JSON 객체 파싱 성공:`, representativeKeywords);
        }
        // 3차: 일반 JSON 파싱 시도
        else {
          representativeKeywords = JSON.parse(rawKeywords);
          controllerLogger.info(`일반 JSON 파싱 성공:`, representativeKeywords);
        }
      } catch (e) {
        controllerLogger.info(`JSON 파싱 실패, 텍스트 파싱 시도: ${e.message}`);
        
        // 4차: 콤마로 분리된 문자열 파싱
        if (rawKeywords.includes(',')) {
          representativeKeywords = rawKeywords.split(',')
            .map(k => k.trim())
            .filter(k => k && k !== 'null' && k !== 'undefined');
          controllerLogger.info(`콤마 분리 파싱:`, representativeKeywords);
        }
        // 5차: 공백으로 분리된 문자열 파싱
        else if (rawKeywords.includes(' ')) {
          representativeKeywords = rawKeywords.split(/\s+/)
            .map(k => k.trim())
            .filter(k => k && k !== 'null' && k !== 'undefined');
          controllerLogger.info(`공백 분리 파싱:`, representativeKeywords);
        }
        // 6차: 단일 키워드
        else {
          representativeKeywords = [rawKeywords];
          controllerLogger.info(`단일 키워드:`, representativeKeywords);
        }
      }
      
      // 키워드 배열 정제 및 검증
      if (Array.isArray(representativeKeywords)) {
        representativeKeywords = representativeKeywords
          .filter(k => k && typeof k === 'string' && k.trim() !== '' && k !== 'null' && k !== 'undefined')
          .map(k => k.trim())
          .slice(0, 10); // 최대 10개로 제한
        
        if (representativeKeywords.length === 0) {
          representativeKeywords = null;
        }
      } else {
        representativeKeywords = null;
      }
    }
    
    if (representativeKeywords && representativeKeywords.length > 0) {
      controllerLogger.info(`최종 키워드 추출 완료:`, representativeKeywords);
    } else {
      controllerLogger.info(`키워드 데이터 없음 또는 파싱 실패`);
    }
    
    // 네이버 플레이스 크롤링
    const seoData = await crawlNaverPlaceSEO(placeId, place.place_name, representativeKeywords);
    
    // 메뉴 크롤링 (음식점인 경우)
    controllerLogger.info('메뉴 크롤링 시작');
    const crawledMenuData = await crawlNaverPlaceMenu(placeId, place.category);
    controllerLogger.info('메뉴 크롤링 완료:', crawledMenuData);
    
    // 메뉴 데이터 초기화 (크롤링된 데이터 우선, 없으면 기본값)
    const menuData = crawledMenuData.totalMenus > 0 ? crawledMenuData : (seoData.menu_setting?.menuData || {
      hasMenuPage: false,
      totalMenus: 0,
      menuWithImages: 0,
      menuWithoutImages: 0,
      menuBoardImages: 0,
      imageRatio: 0,
      categories: [],
      averagePrice: 0,
      priceRange: { min: 0, max: 0 },
      menuItems: [],
      top4MenusWithoutImage: [],
      warnings: []
    });
    
    // 기존 리뷰 데이터 조회 (크롤링 대신)
    const reviewData = await getExistingReviewData(placeId);
    
    // 리뷰 데이터를 SEO 데이터에 반영
    if (reviewData.hasReviewData) {
      // 리뷰 점수 계산 (더 상세한 기준)
      let reviewScore = 0;
      let reviewDetails = '';
      
      // 총 리뷰 개수 점수 (30점 만점)
      if (reviewData.totalReviews > 100) {
        reviewScore += 30;
        reviewDetails += `총 리뷰 우수 (${reviewData.totalReviews}개)`;
      } else if (reviewData.totalReviews > 50) {
        reviewScore += 25;
        reviewDetails += `총 리뷰 양호 (${reviewData.totalReviews}개)`;
      } else if (reviewData.totalReviews > 20) {
        reviewScore += 20;
        reviewDetails += `총 리뷰 보통 (${reviewData.totalReviews}개)`;
      } else if (reviewData.totalReviews > 5) {
        reviewScore += 15;
        reviewDetails += `총 리뷰 부족 (${reviewData.totalReviews}개)`;
      } else {
        reviewScore += 5;
        reviewDetails += `총 리뷰 매우 부족 (${reviewData.totalReviews}개)`;
      }
      
      // 최근 2주 영수증 리뷰 점수 (30점 만점)
      if (reviewData.recent2WeeksReceipt > 5) {
        reviewScore += 30;
        reviewDetails += `, 최근 영수증 리뷰 우수 (${reviewData.recent2WeeksReceipt}개)`;
      } else if (reviewData.recent2WeeksReceipt > 2) {
        reviewScore += 20;
        reviewDetails += `, 최근 영수증 리뷰 양호 (${reviewData.recent2WeeksReceipt}개)`;
      } else if (reviewData.recent2WeeksReceipt > 0) {
        reviewScore += 10;
        reviewDetails += `, 최근 영수증 리뷰 부족 (${reviewData.recent2WeeksReceipt}개)`;
      } else {
        reviewDetails += `, 최근 영수증 리뷰 없음`;
      }
      
      // 최근 2주 블로그 리뷰 점수 (30점 만점)
      if (reviewData.recent2WeeksBlog > 3) {
        reviewScore += 30;
        reviewDetails += `, 최근 블로그 리뷰 우수 (${reviewData.recent2WeeksBlog}개)`;
      } else if (reviewData.recent2WeeksBlog > 1) {
        reviewScore += 20;
        reviewDetails += `, 최근 블로그 리뷰 양호 (${reviewData.recent2WeeksBlog}개)`;
      } else if (reviewData.recent2WeeksBlog > 0) {
        reviewScore += 10;
        reviewDetails += `, 최근 블로그 리뷰 부족 (${reviewData.recent2WeeksBlog}개)`;
      } else {
        reviewDetails += `, 최근 블로그 리뷰 없음`;
      }
      
      // 답변률 점수 (10점 만점)
      if (reviewData.replyRate > 90) {
        reviewScore += 10;
        reviewDetails += `, 답변률 우수 (${reviewData.replyRate}%)`;
      } else if (reviewData.replyRate > 70) {
        reviewScore += 7;
        reviewDetails += `, 답변률 양호 (${reviewData.replyRate}%)`;
      } else if (reviewData.replyRate > 50) {
        reviewScore += 5;
        reviewDetails += `, 답변률 보통 (${reviewData.replyRate}%)`;
      } else if (reviewData.replyRate > 0) {
        reviewScore += 3;
        reviewDetails += `, 답변률 부족 (${reviewData.replyRate}%)`;
      } else {
        reviewDetails += `, 답변 없음`;
      }
      
      seoData.reviews.score = Math.min(100, reviewScore);
      seoData.reviews.details = reviewDetails;
      seoData.reviews.status = reviewScore >= 80 ? 'good' : reviewScore >= 50 ? 'warning' : 'error';
      
      // 리뷰 데이터를 분석 결과에 추가
      seoData.reviews.reviewData = {
        totalReviews: reviewData.totalReviews,
        totalReceiptReviews: reviewData.totalReceiptReviews,
        totalBlogReviews: reviewData.totalBlogReviews,
        recent2WeeksReceipt: reviewData.recent2WeeksReceipt,
        recent2WeeksBlog: reviewData.recent2WeeksBlog,
        replyRate: reviewData.replyRate,
        totalWithReply: reviewData.totalWithReply,
        hasReviewData: reviewData.hasReviewData,
        needsCrawling: reviewData.needsCrawling,
        lastReceiptReviewDate: reviewData.lastReceiptReviewDate,
        lastBlogReviewDate: reviewData.lastBlogReviewDate
      };
    } else {
      seoData.reviews.score = 30;
      seoData.reviews.details = '리뷰 데이터를 불러올 수 없습니다.';
      seoData.reviews.status = 'error';
      
      // 빈 리뷰 데이터 설정
      seoData.reviews.reviewData = {
        totalReviews: 0,
        totalReceiptReviews: 0,
        totalBlogReviews: 0,
        recent2WeeksReceipt: 0,
        recent2WeeksBlog: 0,
        replyRate: 0,
        totalWithReply: 0,
        hasReviewData: false,
        needsCrawling: true,
        lastReceiptReviewDate: null,
        lastBlogReviewDate: null
      };
    }
    
    // 메뉴 데이터를 SEO 데이터에 반영
    if (menuData.hasMenuPage) {
      const menuImageRatio = menuData.totalMenus > 0 ? (menuData.menuWithImages / menuData.totalMenus) : 0;
      
      // 메뉴 점수 계산 (더 상세한 기준)
      let menuScore = 0;
      let menuDetails = '';
      let menuWarnings = [];
      
      // 메뉴 개수 점수 (30점 만점)
      if (menuData.totalMenus > 20) {
        menuScore += 30;
        menuDetails += `메뉴 개수 우수 (${menuData.totalMenus}개)`;
      } else if (menuData.totalMenus > 10) {
        menuScore += 25;
        menuDetails += `메뉴 개수 양호 (${menuData.totalMenus}개)`;
      } else if (menuData.totalMenus > 5) {
        menuScore += 15;
        menuDetails += `메뉴 개수 보통 (${menuData.totalMenus}개)`;
      } else if (menuData.totalMenus > 0) {
        menuScore += 8;
        menuDetails += `메뉴 개수 부족 (${menuData.totalMenus}개)`;
      } else {
        menuDetails += '메뉴 정보 없음';
      }
      
      // 상위 4개 메뉴 이미지 체크 (25점 만점) - 가장 중요
      if (menuData.top4MenusWithoutImage && menuData.top4MenusWithoutImage.length > 0) {
        const missingCount = menuData.top4MenusWithoutImage.length;
        menuScore += Math.max(0, 25 - (missingCount * 8)); // 이미지 없는 메뉴당 8점 차감
        menuWarnings.push(`상위 ${missingCount}개 메뉴에 이미지가 없습니다`);
        menuDetails += `, 상위 메뉴 이미지 누락 ${missingCount}개`;
      } else if (menuData.totalMenus >= 4) {
        menuScore += 25;
        menuDetails += `, 상위 4개 메뉴 이미지 완료`;
      } else if (menuData.totalMenus > 0) {
        menuScore += 20;
        menuDetails += `, 등록된 모든 메뉴에 이미지 있음`;
      }
      
      // 메뉴판 이미지 점수 (15점 만점)
      if (menuData.menuBoardImages > 3) {
        menuScore += 15;
        menuDetails += `, 메뉴판 이미지 우수 (${menuData.menuBoardImages}개)`;
      } else if (menuData.menuBoardImages > 0) {
        menuScore += 8;
        menuDetails += `, 메뉴판 이미지 보통 (${menuData.menuBoardImages}개)`;
      } else {
        menuDetails += ', 메뉴판 이미지 없음';
      }
      
      // 전체 메뉴 이미지 비율 점수 (20점 만점)
      if (menuImageRatio > 0.8) {
        menuScore += 20;
        menuDetails += `, 메뉴 이미지 비율 우수 (${Math.round(menuImageRatio * 100)}%)`;
      } else if (menuImageRatio > 0.5) {
        menuScore += 15;
        menuDetails += `, 메뉴 이미지 비율 양호 (${Math.round(menuImageRatio * 100)}%)`;
      } else if (menuImageRatio > 0.2) {
        menuScore += 8;
        menuDetails += `, 메뉴 이미지 비율 보통 (${Math.round(menuImageRatio * 100)}%)`;
      } else if (menuData.totalMenus > 0) {
        menuDetails += `, 메뉴 이미지 비율 부족 (${Math.round(menuImageRatio * 100)}%)`;
      }
      
      // 메뉴 카테고리 점수 (10점 만점)
      if (menuData.menuCategories && menuData.menuCategories.length > 0) {
        menuScore += 10;
        menuDetails += `, 카테고리 분류 있음 (${menuData.menuCategories.length}개)`;
      }
      
      // 상위 4개 메뉴 이미지 체크 (음식점인 경우 중요)
      let top4MenusWarning = false;
      if (place.category && (place.category.includes('음식') || place.category.includes('식당') || place.category.includes('카페') || place.category.includes('레스토랑'))) {
        const top4Menus = menuData.menuItems.slice(0, 4);
        const top4WithoutImage = top4Menus.filter(menu => !menu.hasImage);
        
        if (top4WithoutImage.length > 0 && top4Menus.length >= 4) {
          top4MenusWarning = true;
          menuScore -= 15; // 상위 4개 메뉴 중 이미지 없는 것이 있으면 감점
          menuDetails += `, ⚠️ 상위 4개 메뉴 중 ${top4WithoutImage.length}개 이미지 없음`;
        } else if (top4Menus.length >= 4) {
          menuDetails += `, 상위 4개 메뉴 이미지 완비`;
        } else if (top4Menus.length > 0) {
          menuDetails += `, 상위 ${top4Menus.length}개 메뉴만 등록됨`;
        }
      }
      
      // 추가 정보
      if (menuData.averagePrice > 0) {
        menuDetails += `, 평균가격 ${menuData.averagePrice.toLocaleString()}원`;
      }
      
      if (menuData.priceRange.min > 0 && menuData.priceRange.max > 0) {
        menuDetails += ` (${menuData.priceRange.min.toLocaleString()}~${menuData.priceRange.max.toLocaleString()}원)`;
      }
      
      seoData.menu_setting.score = Math.min(100, menuScore);
      seoData.menu_setting.details = menuDetails;
      seoData.menu_setting.status = menuScore >= 80 ? 'good' : menuScore >= 50 ? 'warning' : 'error';
      
      // 경고가 있으면 상태를 warning으로 변경
      if (menuWarnings.length > 0 && seoData.menu_setting.status === 'good') {
        seoData.menu_setting.status = 'warning';
      }
      
      // 메뉴 데이터를 분석 결과에 추가
      seoData.menu_setting.menuData = {
        totalMenus: menuData.totalMenus,
        menuWithImages: menuData.menuWithImages,
        menuWithoutImages: menuData.menuWithoutImages,
        menuBoardImages: menuData.menuBoardImages,
        imageRatio: Math.round(menuImageRatio * 100),
        categories: menuData.menuCategories,
        averagePrice: menuData.averagePrice,
        priceRange: menuData.priceRange,
        menuItems: menuData.menuItems.slice(0, 10), // 최대 10개만 저장
        hasTop4Warning: top4MenusWarning || false,
        top4MenusWithoutImage: top4MenusWarning ? menuData.menuItems.slice(0, 4).filter(menu => !menu.hasImage).length : 0
      };
    } else {
      // 음식점이 아니거나 메뉴 페이지가 없는 경우
      if (place.category && (place.category.includes('음식') || place.category.includes('식당') || place.category.includes('카페'))) {
        seoData.menu_setting.score = 30;
        seoData.menu_setting.details = '메뉴 페이지를 찾을 수 없습니다. 메뉴 정보를 등록해주세요.';
        seoData.menu_setting.status = 'error';
      } else {
        seoData.menu_setting.score = 100;
        seoData.menu_setting.details = '메뉴 설정이 필요하지 않은 업종입니다.';
        seoData.menu_setting.status = 'good';
      }
    }
    
    // 경쟁업체 분석
    const competitorData = await analyzeCompetitors(place.category, place.place_name);
    
    // 전체 점수 계산 (중요도 기반 가중평균)
    // 업체명&업종은 제외, 각 항목별 중요도 적용
    const weights = {
      keywords: 100,            // 대표키워드 (가장 중요)
      representative_photo: 70, // 대표사진
      menu_setting: 60,         // 메뉴설정
      reviews: 80,              // 리뷰관리
      reservation: 40,          // 예약
      business_hours: 40,       // 영업시간
      directions: 40,           // 찾아오는길
      notice: 30,               // 공지사항
      coupon: 30,               // 쿠폰
      talk: 20                  // 톡톡
      // business_info는 제외 (설정법이므로)
    };
    
    let totalWeightedScore = 0;
    let totalWeight = 0;
    
    // 각 항목의 점수에 중요도를 적용하여 가중평균 계산
    Object.keys(weights).forEach(key => {
      if (seoData[key] && typeof seoData[key].score === 'number') {
        const weight = weights[key];
        const score = seoData[key].score;
        totalWeightedScore += (score * weight);
        totalWeight += weight;
      }
    });
    
    const overallScore = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;
    
    // SEO 분석 결과 저장
    await handleDbOperation(async () => {
      return SEOAnalysisResult.create({
        place_id: placeId,
        user_id: userId,
        place_name: place.place_name,
        category: place.category,
        overall_score: overallScore,
        representative_photo_score: seoData.representative_photo.score,
        business_info_score: seoData.business_info.score,
        reservation_score: seoData.reservation.score,
        talk_score: seoData.talk.score,
        coupon_score: seoData.coupon.score,
        notice_score: seoData.notice.score,
        business_hours_score: seoData.business_hours.score,
        menu_setting_score: seoData.menu_setting.score,
        directions_score: seoData.directions.score,
        keywords_score: seoData.keywords.score,
        reviews_score: seoData.reviews.score,
        analysis_details: {
          ...seoData,
          // 리뷰 데이터 추가
          reviews: {
            ...seoData.reviews,
            reviewData: seoData.reviews.reviewData
          }
        },
        competitor_data: competitorData,
        analyzed_at: new Date()
      });
    }, "SEO 분석 결과 저장");
    
    const result = {
      placeInfo: {
        place_id: placeId,
        place_name: place.place_name,
        category: place.category
      },
      seoAnalysis: seoData,
      competitorAnalysis: competitorData,
      overallScore,
      analyzedAt: new Date().toISOString()
    };
    
    controllerLogger.info(`SEO 분석 완료 - placeId: ${placeId}, 전체점수: ${overallScore}`);
    return result;
    
  } catch (error) {
    controllerLogger.error('SEO 분석 실패:', error);
    throw error;
  }
};

/**
 * 네이버 플레이스 SEO 데이터 크롤링
 */
async function crawlNaverPlaceSEO(placeId, placeName, representativeKeywords) {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1');
    
    const url = `https://m.place.naver.com/place/${placeId}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // 페이지 로딩 대기 (waitForTimeout 대신 delay 사용)
    await page.waitForFunction(() => document.readyState === 'complete');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const seoData = await page.evaluate((keywords) => {
      const result = {
        representative_photo: { score: 0, details: '', status: 'error' },
        business_info: { score: 0, details: '', status: 'error' },
        reservation: { score: 0, details: '', status: 'error' },
        talk: { score: 0, details: '', status: 'error' },
        coupon: { score: 0, details: '', status: 'error' },
        notice: { score: 0, details: '', status: 'error' },
        business_hours: { score: 0, details: '', status: 'error' },
        menu_setting: { score: 0, details: '', status: 'error' },
        directions: { score: 0, details: '', status: 'error' },
        keywords: { score: 0, details: '', status: 'error' },
        reviews: { score: 0, details: '', status: 'error' }
      };
      
      // 유틸리티 함수: 여러 셀렉터로 요소 찾기
      function findElement(selectors) {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) return element;
        }
        return null;
      }
      
      // 유틸리티 함수: 텍스트가 포함된 요소 찾기
      function findElementByText(selectors, text) {
        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (element.textContent && element.textContent.includes(text)) {
              return element;
            }
          }
        }
        return null;
      }
      
      try {
        // 1. 대표사진 분석 - 여러 셀렉터 시도
        const photoSelectors = [
          '.place_thumb img',
          '.flicking-camera img', 
          '.photo img',
          '.hero_photo img',
          '.place_main_photo img',
          'img[alt*="사진"]',
          'img[alt*="대표"]',
          '.swiper-slide img',
          '.main_photo img'
        ];
        
        const mainImage = findElement(photoSelectors);
        if (mainImage && mainImage.src && 
            !mainImage.src.includes('placeholder') && 
            !mainImage.src.includes('default') &&
            !mainImage.src.includes('no_image') &&
            !mainImage.src.includes('loading') &&
            mainImage.src.includes('http')) {
          result.representative_photo.score = 85;
          result.representative_photo.details = '대표사진이 설정되어 있습니다.';
          result.representative_photo.status = 'good';
          result.representative_photo.recommendations = [];
        } else {
          result.representative_photo.score = 20;
          result.representative_photo.details = '대표사진이 설정되지 않았거나 찾을 수 없습니다.';
          result.representative_photo.status = 'error';
          result.representative_photo.recommendations = [
            '고화질의 매력적인 대표사진을 업로드하세요.',
            '업체의 특징을 잘 보여주는 사진을 선택하세요.',
            '밝고 선명한 이미지를 사용하세요.',
            '정사각형 비율로 최적화된 사진을 준비하세요.'
          ];
        }
        
        // 2. 업체명 & 업종 분석 - 여러 셀렉터 시도
        const nameSelectors = ['.GHAhO', '.place_name', '.business_name', 'h1', '.title', '.name'];
        const categorySelectors = ['.lnJFt', '.category', '.business_category', '.type', '.genre'];
        
        const placeName = findElement(nameSelectors);
        const category = findElement(categorySelectors);
        
        let businessScore = 0;
        let businessDetails = '';
        
        if (placeName && placeName.textContent.trim()) {
          businessScore += 50;
          businessDetails += `업체명: ${placeName.textContent.trim()}`;
        } else {
          businessDetails += '업체명: 없음';
        }
        
        if (category && category.textContent.trim()) {
          businessScore += 30;
          businessDetails += `, 업종: ${category.textContent.trim()}`;
        } else {
          businessDetails += ', 업종: 없음';
        }
        
        result.business_info.score = businessScore;
        result.business_info.details = businessDetails;
        result.business_info.status = businessScore >= 70 ? 'good' : businessScore >= 40 ? 'warning' : 'error';
        
        // 3. 예약 & 톡톡 분석 - 2024년 네이버 플레이스 구조 기반 정확한 감지
        
        // 예약 버튼 감지 - 실제 네이버 플레이스 구조 반영
        let hasReservation = false;
        let reservationElement = null;
        
        // 1차: 가장 확실한 예약 셀렉터들 (2024년 구조)
        const primaryReservationSelectors = [
          'a[href*="/booking"]',           // /place/.../booking 패턴
          'a[href*="booking.naver.com"]',  // booking.naver.com 도메인
          'a.D_Xqt[href*="booking"]',      // D_Xqt 클래스 + booking URL
          'a[role="button"][href*="booking"]' // role="button" + booking URL
        ];
        
        for (const selector of primaryReservationSelectors) {
          reservationElement = document.querySelector(selector);
          if (reservationElement) {
            // 예약 텍스트가 포함되어 있는지 확인
            const text = reservationElement.textContent?.trim();
            if (text && text.includes('예약')) {
              hasReservation = true;
              break;
            }
          }
        }
        
        // 2차: 예약 텍스트와 링크 조합으로 감지
        if (!hasReservation) {
          const bookingLinks = document.querySelectorAll('a[href*="booking"], a[href*="reserve"]');
          for (const link of bookingLinks) {
            const text = link.textContent?.trim();
            if (text && text.includes('예약')) {
              hasReservation = true;
              reservationElement = link;
              break;
            }
          }
        }
        
        // 톡톡 버튼 감지 - 실제 네이버 플레이스 구조 반영
        let hasTalk = false;
        let talkElement = null;
        
        // 1차: 가장 확실한 톡톡 셀렉터들 (2024년 구조)
        const primaryTalkSelectors = [
          'a[href*="talk.naver.com"]',     // talk.naver.com 도메인
          'a.D_Xqt[href*="talk.naver.com"]', // D_Xqt 클래스 + talk URL
          'a[role="button"][href*="talk.naver.com"]' // role="button" + talk URL
        ];
        
        for (const selector of primaryTalkSelectors) {
          talkElement = document.querySelector(selector);
          if (talkElement) {
            // 문의 또는 톡톡 텍스트가 포함되어 있는지 확인
            const text = talkElement.textContent?.trim();
            if (text && (text.includes('문의') || text.includes('톡톡') || text.includes('talk'))) {
              hasTalk = true;
              break;
            }
          }
        }
        
        // 2차: 문의/톡톡 텍스트와 링크 조합으로 감지
        if (!hasTalk) {
          const talkLinks = document.querySelectorAll('a[href*="talk"], a[role="button"]');
          for (const link of talkLinks) {
            const text = link.textContent?.trim();
            if (text && (text.includes('문의') || text.includes('톡톡'))) {
              const href = link.getAttribute('href');
              if (href && (href.includes('talk') || href.includes('biztalk'))) {
                hasTalk = true;
                talkElement = link;
                break;
              }
            }
          }
        }
        
        // 3차: yxkiA 클래스 내부의 링크들 확인 (네이버 플레이스 특정 구조)
        if (!hasReservation || !hasTalk) {
          const actionButtons = document.querySelectorAll('.yxkiA a, .yxkiA button');
          for (const button of actionButtons) {
            const text = button.textContent?.trim();
            const href = button.getAttribute('href');
            
            if (!hasReservation && text && text.includes('예약') && href && href.includes('booking')) {
              hasReservation = true;
              reservationElement = button;
            }
            
            if (!hasTalk && text && (text.includes('문의') || text.includes('톡톡')) && href && href.includes('talk')) {
              hasTalk = true;
              talkElement = button;
            }
          }
        }
        
        let reservationScore = 0;
        let talkScore = 0;
        let reservationDetails = '';
        let talkDetails = '';
        
        if (hasReservation) {
          reservationScore = 100;
          reservationDetails = '예약: 활성화';
          result.reservation.recommendations = [];
        } else {
          reservationDetails = '예약: 비활성화';
          result.reservation.recommendations = [
            '온라인 예약 시스템을 연동하세요.',
            '네이버 예약이나 제휴 예약 시스템을 활용하세요.',
            '전화 예약도 가능하다면 운영시간을 명시하세요.'
          ];
        }
        
        if (hasTalk) {
          talkScore = 100;
          talkDetails = '톡톡: 활성화';
          result.talk.recommendations = [];
        } else {
          talkDetails = '톡톡: 비활성화';
          result.talk.recommendations = [
            '네이버 톡톡 서비스를 활성화하세요.',
            '고객 문의에 신속하게 응답할 수 있도록 준비하세요.',
            '자주 묻는 질문에 대한 자동 응답을 설정하세요.'
          ];
        }
        
        result.reservation.score = reservationScore;
        result.reservation.details = reservationDetails;
        result.reservation.status = reservationScore >= 70 ? 'good' : 'error';
        
        result.talk.score = talkScore;
        result.talk.details = talkDetails;
        result.talk.status = talkScore >= 70 ? 'good' : 'error';
        
        // 4. 쿠폰 분석 - SVG 및 아이콘 요소 확인
        const couponSelectors = [
          '.wPzUm .zIZ0i', 
          '.place_coupon', 
          '.coupon_icon', 
          '*[data-log*="coupon"]',
          'svg[class*="coupon"]',
          '.coupon',
          '*[class*="coupon"]'
        ];
        
        const couponElement = findElement(couponSelectors) || findElementByText(['div', 'span', 'button'], '쿠폰');
        if (couponElement) {
          result.coupon.score = 90;
          result.coupon.details = '쿠폰이 등록되어 있습니다.';
          result.coupon.status = 'good';
        } else {
          result.coupon.details = '쿠폰이 등록되지 않았습니다.';
        }
        
        // 5. 공지사항 분석
        const noticeSelectors = [
          '.notice', 
          '.announcement', 
          '.info_notice', 
          '*[data-log*="notice"]',
          '.notice_area',
          '.announcement_area'
        ];
        
        const noticeElement = findElement(noticeSelectors) || findElementByText(['div', 'span'], '공지');
        if (noticeElement && noticeElement.textContent.trim() && noticeElement.textContent.length > 10) {
          result.notice.score = 85;
          result.notice.details = '공지사항이 등록되어 있습니다.';
          result.notice.status = 'good';
        } else {
          result.notice.details = '공지사항이 등록되지 않았습니다.';
        }
        
        // 6. 영업시간 분석 - 더 정확한 시간 정보 확인
        const hoursSelectors = [
          '.A_cdD', 
          '.U7pYf', 
          '.hours', 
          '*[data-log*="hours"]',
          '.business_hours',
          '.operating_hours',
          '.time_info'
        ];
        
        const hoursElement = findElement(hoursSelectors);
        if (hoursElement && hoursElement.textContent.trim()) {
          const hoursText = hoursElement.textContent.trim();
          // 실제 시간 형식이 있는지 확인 (예: 09:00, 21:30, 오전, 오후 등)
          if (hoursText.match(/\d{1,2}:\d{2}/) || 
              hoursText.includes('시') || 
              hoursText.includes('분') ||
              hoursText.includes('오전') ||
              hoursText.includes('오후') ||
              hoursText.includes('영업') ||
              hoursText.includes('라스트오더')) {
            result.business_hours.score = 100;
            result.business_hours.details = '영업시간이 설정되어 있습니다.';
            result.business_hours.status = 'good';
            result.business_hours.recommendations = [];
          } else {
            result.business_hours.details = '영업시간 정보가 불완전합니다.';
            result.business_hours.score = 60;
            result.business_hours.status = 'warning';
            result.business_hours.recommendations = [
              '영업시간을 더 정확하게 설정하세요.',
              '휴무일이나 특별 운영시간도 명시하세요.'
            ];
          }
        } else {
          result.business_hours.details = '영업시간이 설정되지 않았습니다.';
          result.business_hours.recommendations = [
            '영업시간을 반드시 설정하세요.',
            '정확한 개점/마감 시간을 입력하세요.',
            '휴무일 정보도 함께 제공하세요.',
            '라스트오더 시간이 있다면 명시하세요.'
          ];
        }
        
        // 7. 메뉴 설정 분석 (홈페이지에서 기본 감지만)
        const menuSelectors = [
          '.menu_item', 
          '.menu', 
          '*[data-log*="menu"]', 
          '.item', 
          '.menu_list li',
          '.food_item',
          '.dish',
          '.menu_card'
        ];
        
        let menuCount = 0;
        for (const selector of menuSelectors) {
          const elements = document.querySelectorAll(selector);
          menuCount = Math.max(menuCount, elements.length);
        }
        
        // 홈페이지에서는 기본적인 메뉴 감지만 수행 (메뉴 페이지 크롤링이 별도로 진행됨)
        if (menuCount > 0) {
          result.menu_setting.score = Math.min(60, 20 + (menuCount * 10)); // 임시 점수
          result.menu_setting.details = `홈페이지에서 약 ${menuCount}개의 메뉴 요소 발견 (상세 분석 중...)`;
          result.menu_setting.status = 'warning';
        } else {
          result.menu_setting.score = 20;
          result.menu_setting.details = '홈페이지에서 메뉴 정보를 찾을 수 없습니다 (메뉴 페이지 분석 중...)';
          result.menu_setting.status = 'warning';
        }
        
        // 8. 찾아오는길 분석 - 위치 정보 확인
        const directionSelectors = [
          '.zPfVt', 
          '.directions', 
          '.location_info', 
          '*[data-log*="direction"]',
          '.address',
          '.location',
          '.way_to_come'
        ];
        
        const directionElement = findElement(directionSelectors);
        if (directionElement && directionElement.textContent.trim() && directionElement.textContent.length > 20) {
          // 실제 길찾기 정보가 있는지 확인 (주소, 지하철역, 출구 등)
          const directionText = directionElement.textContent;
          if (directionText.includes('출구') || 
              directionText.includes('역') ||
              directionText.includes('도보') ||
              directionText.includes('분') ||
              directionText.includes('거리') ||
              directionText.includes('위치')) {
            result.directions.score = 90;
            result.directions.details = '상세한 위치 정보가 설정되어 있습니다.';
            result.directions.status = 'good';
          } else {
            result.directions.score = 60;
            result.directions.details = '기본 위치 정보가 있습니다.';
            result.directions.status = 'warning';
          }
        } else {
          result.directions.details = '상세한 위치 정보가 설정되지 않았습니다.';
        }
        
        // 9. 대표키워드 분석 (DB에서 가져온 값 사용)
        if (keywords && keywords.length > 0) {
          result.keywords.score = Math.min(85, 50 + (keywords.length * 10));
          result.keywords.details = `대표키워드 ${keywords.length}개: ${keywords.join(', ')}`;
          result.keywords.status = 'good';
          result.keywords.recommendations = keywords.length < 3 ? [
            '대표키워드를 3개 이상 설정하면 더 좋습니다.',
            '업종과 지역을 포함한 키워드를 추가하세요.'
          ] : [];
          console.log('크롤링 중 - 키워드 데이터:', keywords);
        } else {
          result.keywords.score = 30;
          result.keywords.details = '대표키워드가 설정되지 않았습니다. 키워드 크롤링을 먼저 실행해주세요.';
          result.keywords.status = 'warning';
          result.keywords.recommendations = [
            '네이버 비즈니스에서 대표키워드를 설정하세요.',
            '고객이 검색할 만한 키워드를 3-5개 선택하세요.',
            '업종명, 지역명, 특징을 포함한 키워드를 사용하세요.',
            '경쟁업체가 사용하지 않는 차별화된 키워드도 포함하세요.'
          ];
          console.log('크롤링 중 - 키워드 데이터 없음');
        }
        
        // 10. 리뷰 분석 - 더 정확한 리뷰 수 파악
        const reviewSelectors = [
          '.review', 
          '.review_item', 
          '*[data-log*="review"]', 
          '.review_list li',
          '.comment',
          '.review_card'
        ];
        
        const reviewCountSelectors = [
          '.review_count', 
          '.count', 
          '*[data-log*="review_count"]',
          '.total_count',
          '.review_total'
        ];
        
        let reviewCount = 0;
        let receiptReviewCount = 0;
        let blogReviewCount = 0;
        
        // 리뷰 개수 텍스트에서 숫자 추출
        for (const selector of reviewCountSelectors) {
          const countElement = document.querySelector(selector);
          if (countElement) {
            const countMatch = countElement.textContent.match(/(\d+)/);
            if (countMatch) {
              reviewCount = Math.max(reviewCount, parseInt(countMatch[1]));
            }
          }
        }
        
        // 리뷰 요소 개수도 확인
        for (const selector of reviewSelectors) {
          const elements = document.querySelectorAll(selector);
          reviewCount = Math.max(reviewCount, elements.length);
        }
        
        // 페이지 전체에서 리뷰 관련 숫자 찾기
        const allText = document.body.textContent;
        const reviewMatches = allText.match(/리뷰\s*(\d+)/g) || allText.match(/(\d+)\s*개\s*리뷰/g);
        if (reviewMatches) {
          for (const match of reviewMatches) {
            const numberMatch = match.match(/(\d+)/);
            if (numberMatch) {
              reviewCount = Math.max(reviewCount, parseInt(numberMatch[1]));
            }
          }
        }
        
        // 영수증 리뷰와 블로그 리뷰 개수 찾기
        const receiptMatches = allText.match(/영수증\s*(\d+)/) || allText.match(/영수증리뷰\s*(\d+)/);
        if (receiptMatches) {
          receiptReviewCount = parseInt(receiptMatches[1]) || 0;
        }
        
        const blogMatches = allText.match(/블로그\s*(\d+)/) || allText.match(/블로그리뷰\s*(\d+)/);
        if (blogMatches) {
          blogReviewCount = parseInt(blogMatches[1]) || 0;
        }
        
        // 리뷰 관련 데이터를 별도로 저장
        const reviewData = {
          totalReviews: reviewCount,
          receiptReviews: receiptReviewCount,
          blogReviews: blogReviewCount,
          recent2WeeksReceipt: 0, // 별도 크롤링 필요
          recent2WeeksBlog: 0 // 별도 크롤링 필요
        };
        
        if (reviewCount > 100) {
          result.reviews.score = 95;
          result.reviews.status = 'good';
        } else if (reviewCount > 50) {
          result.reviews.score = 85;
          result.reviews.status = 'good';
        } else if (reviewCount > 20) {
          result.reviews.score = 75;
          result.reviews.status = 'good';
        } else if (reviewCount > 10) {
          result.reviews.score = 60;
          result.reviews.status = 'warning';
        } else if (reviewCount > 5) {
          result.reviews.score = 45;
          result.reviews.status = 'warning';
        } else {
          result.reviews.score = 25;
          result.reviews.status = 'error';
        }
        result.reviews.details = `총 ${reviewCount}개 리뷰 (영수증: ${receiptReviewCount}개, 블로그: ${blogReviewCount}개)`;
        result.reviews.reviewData = reviewData;
        
      } catch (evalError) {
        console.log('페이지 평가 중 오류:', evalError);
      }
      
      return result;
    }, representativeKeywords);
    
    return seoData;
    
  } catch (error) {
    logger.error('네이버 플레이스 크롤링 오류:', error);
    // 오류 발생 시에도 기본 데이터 반환
    return {
      representative_photo: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      business_info: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      reservation: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      talk: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      coupon: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      notice: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      business_hours: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      menu_setting: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      directions: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      keywords: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' },
      reviews: { score: 0, details: '크롤링 오류가 발생했습니다.', status: 'error' }
    };
  } finally {
    await browser.close();
  }
}

/**
 * 경쟁업체 분석
 */
async function analyzeCompetitors(category, placeName) {
  // 임시 경쟁업체 데이터 (실제로는 네이버 검색 API나 크롤링으로 구현)
  const competitorData = [
    {
      name: `${category} 상위업체 A`,
      score: Math.floor(Math.random() * 20) + 80, // 80-100
      features: {
        representative_photo: true,
        business_info: true,
        reservation_talk: true,
        coupon: Math.random() > 0.5,
        notice: Math.random() > 0.7,
        business_hours: true,
        menu_setting: true,
        directions: true,
        keywords: true,
        reviews: true
      }
    },
    {
      name: `${category} 상위업체 B`,
      score: Math.floor(Math.random() * 20) + 75, // 75-95
      features: {
        representative_photo: true,
        business_info: true,
        reservation_talk: Math.random() > 0.3,
        coupon: Math.random() > 0.6,
        notice: Math.random() > 0.8,
        business_hours: true,
        menu_setting: true,
        directions: true,
        keywords: Math.random() > 0.4,
        reviews: true
      }
    },
    {
      name: `${category} 상위업체 C`,
      score: Math.floor(Math.random() * 25) + 70, // 70-95
      features: {
        representative_photo: true,
        business_info: true,
        reservation_talk: Math.random() > 0.4,
        coupon: Math.random() > 0.7,
        notice: Math.random() > 0.6,
        business_hours: true,
        menu_setting: Math.random() > 0.3,
        directions: true,
        keywords: Math.random() > 0.5,
        reviews: true
      }
    }
  ];
  
  return competitorData;
}

/**
 * 기존 리뷰 테이블에서 리뷰 데이터 조회
 */
async function getExistingReviewData(placeId) {
  try {
    logger.info(`기존 리뷰 데이터 조회 시작: ${placeId}`);
    
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    // 영수증 리뷰 조회
    const receiptReviews = await Review.findAll({
      where: {
        place_id: placeId,
        review_type: 'receipt'
      },
      attributes: ['id', 'review_date', 'has_owner_reply', 'reply'],
      order: [['review_date', 'DESC']],
      raw: true
    });
    
    // 블로그 리뷰 조회
    const blogReviews = await Review.findAll({
      where: {
        place_id: placeId,
        review_type: 'blog'
      },
      attributes: ['id', 'review_date'],
      order: [['review_date', 'DESC']],
      raw: true
    });
    
    // 최근 2주간 영수증 리뷰
    const recent2WeeksReceipt = receiptReviews.filter(review => 
      new Date(review.review_date) >= twoWeeksAgo
    ).length;
    
    // 최근 2주간 블로그 리뷰
    const recent2WeeksBlog = blogReviews.filter(review => 
      new Date(review.review_date) >= twoWeeksAgo
    ).length;
    
    // 답변이 있는 영수증 리뷰 수
    const totalWithReply = receiptReviews.filter(review => 
      review.has_owner_reply || review.reply
    ).length;
    
    // 답변률 계산
    const replyRate = receiptReviews.length > 0 
      ? Math.round((totalWithReply / receiptReviews.length) * 100) 
      : 0;
    
    const result = {
      hasReviewData: true,
      totalReviews: receiptReviews.length + blogReviews.length,
      totalReceiptReviews: receiptReviews.length,
      totalBlogReviews: blogReviews.length,
      recent2WeeksReceipt,
      recent2WeeksBlog,
      replyRate,
      totalWithReply,
      needsCrawling: recent2WeeksReceipt === 0 || recent2WeeksBlog === 0, // 2주간 데이터가 없으면 크롤링 필요
      lastReceiptReviewDate: receiptReviews.length > 0 ? receiptReviews[0].review_date : null,
      lastBlogReviewDate: blogReviews.length > 0 ? blogReviews[0].review_date : null
    };
    
    logger.info(`기존 리뷰 데이터 조회 완료: 총 ${result.totalReviews}개 (영수증: ${result.totalReceiptReviews}, 블로그: ${result.totalBlogReviews}), 최근 2주 (영수증: ${result.recent2WeeksReceipt}, 블로그: ${result.recent2WeeksBlog}), 답변률: ${result.replyRate}%`);
    
    return result;
    
  } catch (error) {
    logger.error('기존 리뷰 데이터 조회 오류:', error);
    return {
      hasReviewData: false,
      totalReviews: 0,
      totalReceiptReviews: 0,
      totalBlogReviews: 0,
      recent2WeeksReceipt: 0,
      recent2WeeksBlog: 0,
      replyRate: 0,
      totalWithReply: 0,
      needsCrawling: true,
      lastReceiptReviewDate: null,
      lastBlogReviewDate: null
    };
  }
}

/**
 * 네이버 플레이스 메뉴 페이지 크롤링 (음식점인 경우)
 */
async function crawlNaverPlaceMenu(placeId, category) {
  // 음식점이 아닌 경우 메뉴 크롤링 생략
  if (!category || (!category.includes('음식') && !category.includes('식당') && !category.includes('카페') && !category.includes('요리') && !category.includes('레스토랑') && !category.includes('치킨') && !category.includes('피자') && !category.includes('햄버거') && !category.includes('분식') && !category.includes('중국') && !category.includes('일식') && !category.includes('한식') && !category.includes('양식') && !category.includes('베이커리') && !category.includes('디저트'))) {
    logger.info(`음식점이 아님으로 메뉴 크롤링 생략: ${category}`);
    return {
      hasMenuPage: false,
      menuItems: [],
      menuBoardImages: 0,
      totalMenus: 0,
      menuWithImages: 0,
      menuWithoutImages: 0,
      menuCategories: []
    };
  }

  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1');
    
    const menuUrl = `https://m.place.naver.com/restaurant/${placeId}/menu/list?entry=plt`;
    logger.info(`메뉴 페이지 크롤링 시작: ${menuUrl}`);
    
    try {
      await page.goto(menuUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // 페이지 로딩 대기
      await page.waitForFunction(() => document.readyState === 'complete');
      await new Promise(resolve => setTimeout(resolve, 5000)); // 더 긴 대기 시간
      
      // 메뉴가 실제로 로드되었는지 확인
      await page.waitForSelector('body', { timeout: 10000 });
      
    } catch (error) {
      logger.error(`메뉴 페이지 로딩 실패: ${error.message}`);
      // 메뉴 페이지에 접근할 수 없으면 기본값 반환
      return {
        hasMenuPage: false,
        menuItems: [],
        menuBoardImages: 0,
        totalMenus: 0,
        menuWithImages: 0,
        menuWithoutImages: 0,
        menuCategories: [],
        averagePrice: 0,
        priceRange: { min: 0, max: 0 },
        top4MenusWithoutImage: []
      };
    }
    await page.waitForFunction(() => document.readyState === 'complete');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const menuData = await page.evaluate(() => {
      const result = {
        hasMenuPage: true,
        menuItems: [],
        menuBoardImages: 0,
        totalMenus: 0,
        menuWithImages: 0,
        menuWithoutImages: 0,
        menuCategories: [],
        averagePrice: 0,
        priceRange: { min: Infinity, max: 0 }
      };
      
      try {
        // 디버깅: 페이지 내용 확인
        console.log('=== 메뉴 페이지 디버깅 시작 ===');
        console.log('페이지 제목:', document.title);
        console.log('페이지 URL:', window.location.href);
        console.log('body innerHTML 길이:', document.body.innerHTML.length);
        console.log('전체 텍스트 미리보기:', document.body.textContent.substring(0, 500));
        
        // 메뉴 관련 키워드 검색
        const menuKeywords = ['메뉴', '원', '가격', 'menu', 'Menu'];
        for (const keyword of menuKeywords) {
          const count = (document.body.textContent.match(new RegExp(keyword, 'g')) || []).length;
          console.log(`"${keyword}" 키워드 발견 횟수: ${count}`);
        }
        
        // 가능한 메뉴 셀렉터들 테스트
        const testSelectors = [
          '.E2jtL',
          '.place_section_content .list_item',
          '.menu_list .list_item',
          '.list_item',
          '.menu_item',
          'div[class*="menu"]',
          'div[class*="Menu"]',
          'div[class*="item"]',
          'div[class*="Item"]'
        ];
        
        for (const selector of testSelectors) {
          const elements = document.querySelectorAll(selector);
          console.log(`셀렉터 "${selector}": ${elements.length}개 발견`);
          if (elements.length > 0 && elements.length < 20) {
            for (let i = 0; i < Math.min(3, elements.length); i++) {
              console.log(`  - ${i+1}번째 요소 텍스트: ${elements[i].textContent.trim().substring(0, 100)}`);
            }
          }
        }
        
        // 에러 페이지인지 확인
        if (document.body.textContent.includes('페이지를 찾을 수 없습니다') || 
            document.body.textContent.includes('404') ||
            document.body.textContent.includes('Not Found')) {
          console.log('메뉴 페이지를 찾을 수 없음');
          result.hasMenuPage = false;
          return result;
        }
        
        // 1. 메뉴판 이미지 개수 확인 (개선된 셀렉터)
        let menuBoardImages = 0;
        
        // 최신 네이버 플레이스 메뉴판 이미지 셀렉터들
        const menuBoardSelectors = [
          'img[src*="menu"]',
          'img[alt*="메뉴"]',
          '.place_section_content img',
          '.menu_list img',
          '.restaurant_menu img',
          '.menu_photo img'
        ];
        
        for (const selector of menuBoardSelectors) {
          const images = document.querySelectorAll(selector);
          menuBoardImages = Math.max(menuBoardImages, images.length);
        }
        
        result.menuBoardImages = menuBoardImages;
        console.log('메뉴판 이미지 개수:', menuBoardImages);
        
        // 2. 메뉴 카테고리 정보 수집 (개선된 셀렉터)
        const categorySelectors = [
          '.menu_category',
          '.category_name', 
          '.menu_group_title',
          '.place_section_header',
          'h3',
          'h4'
        ];
        
        const categories = [];
        for (const selector of categorySelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const categoryName = el.textContent.trim();
            if (categoryName && categoryName.length > 1 && categoryName.length < 20 && !categories.includes(categoryName)) {
              categories.push(categoryName);
            }
          }
        }
        result.menuCategories = categories;
        console.log('메뉴 카테고리:', categories);
        
        // 3. 개별 메뉴 아이템들 크롤링 (2024년 네이버 플레이스 구조 반영)
        
        // 최신 네이버 플레이스 메뉴 셀렉터들 (우선순위 순서)
        const menuSelectors = [
          '.E2jtL',                    // 기존 주요 셀렉터
          '.place_section_content .list_item',  // 최신 구조
          '.menu_list .list_item',      // 메뉴 리스트 구조
          '.menu_item',                 // 일반적인 메뉴 아이템
          '.item_inner',                // 내부 아이템
          '.menu_list_item',            // 메뉴 리스트 아이템
          '.list_item'                  // 리스트 아이템
        ];
        
        let menuItems = [];
        let bestSelector = null;
        
        // 가장 많은 메뉴를 찾을 수 있는 셀렉터 찾기
        for (const selector of menuSelectors) {
          const items = document.querySelectorAll(selector);
          if (items.length > menuItems.length) {
            menuItems = Array.from(items);
            bestSelector = selector;
          }
        }
        
        console.log(`최적 메뉴 셀렉터: ${bestSelector}, 발견된 메뉴 수: ${menuItems.length}`);
        
        result.totalMenus = menuItems.length;
        let totalPrice = 0;
        let priceCount = 0;
        
        // 상위 4개 메뉴의 이미지 유무 체크
        let top4MenusWithoutImage = [];
        
        for (let index = 0; index < menuItems.length; index++) {
          const item = menuItems[index];
          const menuItem = {
            name: '',
            price: '',
            priceNumber: 0,
            description: '',
            hasImage: false,
            imageUrl: '',
            category: '',
            position: index + 1
          };
          
          // 메뉴명 추출 (개선된 셀렉터 우선순위)
          const nameSelectors = [
            '.lPzHi',                    // 기존 주요 셀렉터
            '.place_menu_title',         // 최신 메뉴 제목
            '.menu_title',               // 메뉴 제목
            '.menu_name',                // 메뉴명
            '.item_name',                // 아이템명
            '.name',                     // 일반 이름
            '.title',                    // 제목
            'strong',                    // 강조 텍스트 (메뉴명은 보통 굵게)
            'span:first-child'           // 첫 번째 스팬 (메뉴명일 가능성 높음)
          ];
          
          for (const selector of nameSelectors) {
            const nameElement = item.querySelector(selector);
            if (nameElement && nameElement.textContent.trim()) {
              const nameText = nameElement.textContent.trim();
              // 가격이 아닌 실제 메뉴명인지 확인
              if (!nameText.includes('원') && !nameText.match(/^\d+[,\d]*$/)) {
                menuItem.name = nameText;
                break;
              }
            }
          }
          
          // 가격 추출 (개선된 셀렉터 우선순위)
          const priceSelectors = [
            '.GXS1X em',                 // 기존 주요 가격 셀렉터
            '.place_menu_price',         // 최신 가격 셀렉터
            '.menu_price',               // 메뉴 가격
            '.price',                    // 일반 가격
            '.amount',                   // 금액
            '.cost',                     // 비용
            'em',                        // 강조 (가격은 보통 em 태그)
            'span[class*="price"]',      // 가격 관련 클래스
            'span:contains("원")'        // '원'이 포함된 스팬
          ];
          
          for (const selector of priceSelectors) {
            const priceElement = item.querySelector(selector);
            if (priceElement && priceElement.textContent.trim()) {
              const priceText = priceElement.textContent.trim();
              // 가격 형태인지 확인 (숫자 + 원 또는 콤마가 포함된 숫자)
              if (priceText.includes('원') || priceText.match(/^\d+[,\d]*$/)) {
                menuItem.price = priceText;
                
                // 숫자만 추출하여 가격 범위 계산
                const priceMatch = priceText.match(/[\d,]+/);
                if (priceMatch) {
                  const priceNumber = parseInt(priceMatch[0].replace(/,/g, ''));
                  if (priceNumber > 0 && priceNumber < 1000000) { // 100만원 이하만 유효한 가격으로 인정
                    menuItem.priceNumber = priceNumber;
                    totalPrice += priceNumber;
                    priceCount++;
                    result.priceRange.min = Math.min(result.priceRange.min, priceNumber);
                    result.priceRange.max = Math.max(result.priceRange.max, priceNumber);
                  }
                }
                break;
              }
            }
          }
          
          // 설명 추출 (개선된 셀렉터 우선순위)
          const descSelectors = [
            '.kPogF',                    // 기존 주요 설명 셀렉터
            '.place_menu_desc',          // 최신 메뉴 설명
            '.menu_desc',                // 메뉴 설명
            '.description',              // 일반 설명
            '.desc',                     // 축약 설명
            '.item_desc',                // 아이템 설명
            '.menu_description'          // 메뉴 설명
          ];
          
          for (const selector of descSelectors) {
            const descElement = item.querySelector(selector);
            if (descElement && descElement.textContent.trim()) {
              const descText = descElement.textContent.trim();
              // 가격이 아닌 실제 설명인지 확인
              if (!descText.includes('원') && descText.length > 5) {
                menuItem.description = descText;
                break;
              }
            }
          }
          
          // 이미지 추출 (개선된 이미지 감지 로직)
          const imageSelectors = [
            '.K0PDV',                    // 기존 주요 이미지 셀렉터
            '.place_menu_image img',     // 최신 메뉴 이미지
            '.menu_image img',           // 메뉴 이미지
            '.item_image img',           // 아이템 이미지
            '.photo img',                // 사진
            'img'                        // 일반 이미지
          ];
          
          for (const selector of imageSelectors) {
            const imageElement = item.querySelector(selector);
            if (imageElement && imageElement.src) {
              const imgSrc = imageElement.src.toLowerCase();
              // 유효한 이미지인지 확인 (더 엄격한 조건)
              if (imgSrc.includes('http') && 
                  !imgSrc.includes('placeholder') && 
                  !imgSrc.includes('default') &&
                  !imgSrc.includes('no_image') &&
                  !imgSrc.includes('blank') &&
                  !imgSrc.includes('loading') &&
                  !imgSrc.includes('1x1') &&
                  (imgSrc.includes('jpg') || imgSrc.includes('jpeg') || imgSrc.includes('png') || imgSrc.includes('webp'))) {
                menuItem.hasImage = true;
                menuItem.imageUrl = imageElement.src;
                result.menuWithImages++;
                break;
              }
            }
          }
          
          if (!menuItem.hasImage) {
            result.menuWithoutImages++;
            
            // 상위 4개 메뉴 중 이미지 없는 항목 기록 (메뉴명이 있는 경우만)
            if (index < 4 && menuItem.name && menuItem.name.length > 1) {
              top4MenusWithoutImage.push({
                position: index + 1,
                name: menuItem.name,
                price: menuItem.price
              });
            }
          }
          
          // 카테고리 정보 (상위 요소에서 찾기)
          let categoryParent = item.closest('.menu_group, .category_group, .place_section');
          if (categoryParent) {
            const categoryElement = categoryParent.querySelector('.category_name, .group_title, .section_title, h3, h4');
            if (categoryElement) {
              menuItem.category = categoryElement.textContent.trim();
            }
          }
          
          // 메뉴명이 있는 경우만 결과에 추가
          if (menuItem.name && menuItem.name.length > 1) {
            result.menuItems.push(menuItem);
          }
        }
        
        // 상위 4개 메뉴 이미지 없는 항목 정보 추가
        result.top4MenusWithoutImage = top4MenusWithoutImage;
        
        // 평균 가격 계산
        if (priceCount > 0) {
          result.averagePrice = Math.round(totalPrice / priceCount);
        }
        
        // 가격 범위 정리
        if (result.priceRange.min === Infinity) {
          result.priceRange.min = 0;
        }
        
      } catch (evalError) {
        console.log('메뉴 페이지 평가 중 오류:', evalError);
      }
      
      return result;
    });
    
    logger.info(`메뉴 크롤링 완료: 총 ${menuData.totalMenus}개 메뉴, 이미지 있는 메뉴 ${menuData.menuWithImages}개, 메뉴판 이미지 ${menuData.menuBoardImages}개`);
    return menuData;
    
  } catch (error) {
    logger.error('메뉴 페이지 크롤링 오류:', error);
    return {
      hasMenuPage: false,
      menuItems: [],
      menuBoardImages: 0,
      totalMenus: 0,
      menuWithImages: 0,
      menuWithoutImages: 0,
      menuCategories: [],
      averagePrice: 0,
      priceRange: { min: 0, max: 0 }
    };
  } finally {
    await browser.close();
  }
}

/**
 * 네이버 플레이스 리뷰 데이터 크롤링 (영수증 리뷰, 블로그 리뷰)
 */
async function crawlNaverPlaceReviews(placeId) {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1');
    
    const result = {
      hasReviewData: true,
      totalReviews: 0,
      totalReceiptReviews: 0,
      totalBlogReviews: 0,
      recent2WeeksReceipt: 0,
      recent2WeeksBlog: 0,
      replyRate: 0,
      totalWithReply: 0
    };
    
    // 1. 영수증 리뷰 페이지 크롤링
    try {
      const receiptUrl = `https://m.place.naver.com/place/${placeId}/review/ugc`;
      logger.info(`영수증 리뷰 페이지 크롤링 시작: ${receiptUrl}`);
      
      await page.goto(receiptUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForFunction(() => document.readyState === 'complete');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const receiptData = await page.evaluate(() => {
        const data = { total: 0, recent2Weeks: 0, totalWithReply: 0 };
        
        try {
          // 총 영수증 리뷰 수 확인
          const totalCountSelectors = ['.review_count', '.count', '.total_count', '.place_section_count'];
          for (const selector of totalCountSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              const totalMatch = element.textContent.match(/(\d+)/);
              if (totalMatch) {
                data.total = Math.max(data.total, parseInt(totalMatch[1]));
              }
            }
          }
          
          // 리뷰 목록에서 최근 2주 데이터 확인
          const reviewSelectors = ['.review_item', '.item', '.ugc_item', '.place_review_item'];
          let reviewItems = [];
          for (const selector of reviewSelectors) {
            const items = document.querySelectorAll(selector);
            if (items.length > reviewItems.length) {
              reviewItems = Array.from(items);
            }
          }
          
          const twoWeeksAgo = new Date();
          twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
          
          for (const item of reviewItems) {
            // 날짜 확인
            const dateSelectors = ['.date', '.review_date', '.time', '.visit_date'];
            let dateFound = false;
            
            for (const selector of dateSelectors) {
              const dateElement = item.querySelector(selector);
              if (dateElement && !dateFound) {
                const dateText = dateElement.textContent;
                // 날짜 파싱 (예: "2주 전", "1일 전", "2024.01.15" 등)
                if (dateText.includes('일 전') || dateText.includes('시간 전') || dateText.includes('분 전')) {
                  data.recent2Weeks++;
                  dateFound = true;
                } else if (dateText.includes('주 전')) {
                  const weeksMatch = dateText.match(/(\d+)주 전/);
                  if (weeksMatch && parseInt(weeksMatch[1]) <= 2) {
                    data.recent2Weeks++;
                    dateFound = true;
                  }
                }
              }
            }
            
            // 답변 여부 확인
            const replySelectors = ['.reply', '.owner_reply', '.business_reply', '.ceo_reply'];
            for (const selector of replySelectors) {
              const replyElement = item.querySelector(selector);
              if (replyElement && replyElement.textContent.trim()) {
                data.totalWithReply++;
                break;
              }
            }
          }
        } catch (error) {
          console.log('영수증 리뷰 크롤링 오류:', error);
        }
        
        return data;
      });
      
      result.totalReceiptReviews = receiptData.total;
      result.recent2WeeksReceipt = receiptData.recent2Weeks;
      result.totalWithReply = receiptData.totalWithReply;
      result.totalReviews += receiptData.total;
      
    } catch (error) {
      logger.error('영수증 리뷰 크롤링 오류:', error);
    }
    
    // 2. 블로그 리뷰 페이지 크롤링
    try {
      const blogUrl = `https://m.place.naver.com/place/${placeId}/review/visitor`;
      logger.info(`블로그 리뷰 페이지 크롤링 시작: ${blogUrl}`);
      
      await page.goto(blogUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForFunction(() => document.readyState === 'complete');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const blogData = await page.evaluate(() => {
        const data = { total: 0, recent2Weeks: 0 };
        
        try {
          // 총 블로그 리뷰 수 확인
          const totalCountSelectors = ['.review_count', '.count', '.total_count', '.place_section_count'];
          for (const selector of totalCountSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              const totalMatch = element.textContent.match(/(\d+)/);
              if (totalMatch) {
                data.total = Math.max(data.total, parseInt(totalMatch[1]));
              }
            }
          }
          
          // 리뷰 목록에서 최근 2주 데이터 확인
          const reviewSelectors = ['.review_item', '.item', '.visitor_item', '.place_review_item'];
          let reviewItems = [];
          for (const selector of reviewSelectors) {
            const items = document.querySelectorAll(selector);
            if (items.length > reviewItems.length) {
              reviewItems = Array.from(items);
            }
          }
          
          const twoWeeksAgo = new Date();
          twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
          
          for (const item of reviewItems) {
            // 날짜 확인
            const dateSelectors = ['.date', '.review_date', '.time', '.visit_date'];
            let dateFound = false;
            
            for (const selector of dateSelectors) {
              const dateElement = item.querySelector(selector);
              if (dateElement && !dateFound) {
                const dateText = dateElement.textContent;
                // 날짜 파싱
                if (dateText.includes('일 전') || dateText.includes('시간 전') || dateText.includes('분 전')) {
                  data.recent2Weeks++;
                  dateFound = true;
                } else if (dateText.includes('주 전')) {
                  const weeksMatch = dateText.match(/(\d+)주 전/);
                  if (weeksMatch && parseInt(weeksMatch[1]) <= 2) {
                    data.recent2Weeks++;
                    dateFound = true;
                  }
                }
              }
            }
          }
        } catch (error) {
          console.log('블로그 리뷰 크롤링 오류:', error);
        }
        
        return data;
      });
      
      result.totalBlogReviews = blogData.total;
      result.recent2WeeksBlog = blogData.recent2Weeks;
      result.totalReviews += blogData.total;
      
    } catch (error) {
      logger.error('블로그 리뷰 크롤링 오류:', error);
    }
    
    // 답변률 계산 (영수증 리뷰 기준)
    if (result.totalReceiptReviews > 0) {
      result.replyRate = Math.round((result.totalWithReply / result.totalReceiptReviews) * 100);
    }
    
    logger.info(`리뷰 크롤링 완료: 총 ${result.totalReviews}개 (영수증: ${result.totalReceiptReviews}, 블로그: ${result.totalBlogReviews}), 최근 2주 (영수증: ${result.recent2WeeksReceipt}, 블로그: ${result.recent2WeeksBlog}), 답변률: ${result.replyRate}%`);
    return result;
    
  } catch (error) {
    logger.error('리뷰 크롤링 오류:', error);
    return {
      hasReviewData: false,
      totalReviews: 0,
      totalReceiptReviews: 0,
      totalBlogReviews: 0,
      recent2WeeksReceipt: 0,
      recent2WeeksBlog: 0,
      replyRate: 0,
      totalWithReply: 0
    };
  } finally {
    await browser.close();
  }
}

/**
 * SEO 최적화를 위한 리뷰 크롤링 (영수증 + 블로그 리뷰)
 */
export const crawlReviewsForSEO = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({ 
    controllerName: 'SEOController', 
    actionName: 'crawlReviewsForSEO' 
  });
  
  try {
    const { placeId } = req.body;
    
    const userId = req.user?.id || req.user?.userId;
    controllerLogger.info(`SEO 리뷰 크롤링 시작 - placeId: ${placeId}, userId: ${userId}`);
    
    const validationError = validateRequiredFields(req.body, ['placeId']);
    if (validationError) {
      const error = new Error(validationError.message);
      error.statusCode = 400;
      throw error;
    }
    
    // 업체 정보 조회
    const place = await handleDbOperation(async () => {
      return Place.findOne({
        where: { 
          place_id: placeId,
          user_id: userId
        },
        raw: true
      });
    }, "업체 정보 조회");
    
    if (!place) {
      const error = new Error('업체 정보를 찾을 수 없거나 접근 권한이 없습니다.');
      error.statusCode = 404;
      throw error;
    }
    
    // 기존 리뷰 크롤러를 사용하여 영수증 리뷰와 블로그 리뷰를 모두 크롤링
    const NaverReviewCrawler = (await import('../services/naverReviewCrawler.js')).default;
    const crawler = new NaverReviewCrawler();
    
    // 영수증 리뷰 크롤링
    controllerLogger.info(`영수증 리뷰 크롤링 시작: ${placeId}`);
    const receiptResult = await crawler.crawlReviews(placeId, 'receipt', 'recommend', 2);
    
    // 블로그 리뷰 크롤링  
    controllerLogger.info(`블로그 리뷰 크롤링 시작: ${placeId}`);
    const blogResult = await crawler.crawlReviews(placeId, 'blog', 'recommend', 2);
    
    const result = {
      placeId,
      placeName: place.place_name,
      receiptReviews: {
        total: receiptResult.totalReviews,
        new: receiptResult.newReviews,
        updated: receiptResult.updatedReviews
      },
      blogReviews: {
        total: blogResult.totalReviews,
        new: blogResult.newReviews,
        updated: blogResult.updatedReviews
      },
      crawledAt: new Date().toISOString()
    };
    
    controllerLogger.info(`SEO 리뷰 크롤링 완료 - placeId: ${placeId}, 영수증: ${receiptResult.newReviews}개 신규, 블로그: ${blogResult.newReviews}개 신규`);
    
    return result;
    
  } catch (error) {
    controllerLogger.error('SEO 리뷰 크롤링 오류:', error);
    throw error;
  }
};

/**
 * 기존 SEO 분석 결과 조회
 */
export const getSEOResult = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({ 
    controllerName: 'SEOController', 
    actionName: 'getSEOResult' 
  });
  
  try {
    const { placeId } = req.params;
    
    const userId = req.user?.id || req.user?.userId;
    controllerLogger.info(`SEO 결과 조회 - placeId: ${placeId}, userId: ${userId}`);
    
    const validationError = validateRequiredFields({ placeId }, ['placeId']);
    if (validationError) {
      const error = new Error(validationError.message);
      error.statusCode = 400;
      throw error;
    }
    
    // 기존 SEO 분석 결과 조회
    const seoResult = await handleDbOperation(async () => {
      return SEOAnalysisResult.findOne({
        where: { 
          place_id: placeId,
          user_id: userId
        },
        order: [['analyzed_at', 'DESC']],
        raw: true
      });
    }, "SEO 분석 결과 조회");
    
    if (!seoResult) {
      return {
        hasResult: false,
        message: '아직 SEO 분석을 실행하지 않았습니다.'
      };
    }
    
    // 점수를 기반으로 상태 계산
    const getStatusFromScore = (score) => {
      if (score >= 80) return 'good';
      if (score >= 60) return 'warning';
      return 'error';
    };
    
    // SEO 분석 결과 구성
    const seoAnalysis = {
      representative_photo: {
        score: seoResult.representative_photo_score,
        details: seoResult.analysis_details?.representative_photo?.details || '',
        status: getStatusFromScore(seoResult.representative_photo_score)
      },
      business_info: {
        score: seoResult.business_info_score,
        details: seoResult.analysis_details?.business_info?.details || '',
        status: getStatusFromScore(seoResult.business_info_score)
      },
      reservation: {
        score: seoResult.reservation_score,
        details: seoResult.analysis_details?.reservation?.details || '',
        status: getStatusFromScore(seoResult.reservation_score)
      },
      talk: {
        score: seoResult.talk_score,
        details: seoResult.analysis_details?.talk?.details || '',
        status: getStatusFromScore(seoResult.talk_score)
      },
      coupon: {
        score: seoResult.coupon_score,
        details: seoResult.analysis_details?.coupon?.details || '',
        status: getStatusFromScore(seoResult.coupon_score)
      },
      notice: {
        score: seoResult.notice_score,
        details: seoResult.analysis_details?.notice?.details || '',
        status: getStatusFromScore(seoResult.notice_score)
      },
      business_hours: {
        score: seoResult.business_hours_score,
        details: seoResult.analysis_details?.business_hours?.details || '',
        status: getStatusFromScore(seoResult.business_hours_score)
      },
      menu_setting: {
        score: seoResult.menu_setting_score,
        details: seoResult.analysis_details?.menu_setting?.details || '',
        status: getStatusFromScore(seoResult.menu_setting_score),
        menuData: seoResult.analysis_details?.menu_setting?.menuData || null
      },
      directions: {
        score: seoResult.directions_score,
        details: seoResult.analysis_details?.directions?.details || '',
        status: getStatusFromScore(seoResult.directions_score)
      },
      keywords: {
        score: seoResult.keywords_score,
        details: seoResult.analysis_details?.keywords?.details || '',
        status: getStatusFromScore(seoResult.keywords_score)
      },
      reviews: {
        score: seoResult.reviews_score,
        details: seoResult.analysis_details?.reviews?.details || '',
        status: getStatusFromScore(seoResult.reviews_score),
        reviewData: seoResult.analysis_details?.reviews?.reviewData || null
      }
    };
    
    const result = {
      hasResult: true,
      placeInfo: {
        place_id: placeId,
        place_name: seoResult.place_name,
        category: seoResult.category
      },
      seoAnalysis,
      competitorAnalysis: seoResult.competitor_data || [],
      overallScore: seoResult.overall_score,
      analyzedAt: seoResult.analyzed_at
    };
    
    controllerLogger.info(`SEO 결과 조회 완료 - placeId: ${placeId}`);
    return result;
    
  } catch (error) {
    controllerLogger.error('SEO 결과 조회 실패:', error);
    throw error;
  }
};
