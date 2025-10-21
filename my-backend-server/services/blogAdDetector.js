// services/blogAdDetector.js
import 'dotenv/config';
import { createLogger } from '../lib/logger.js';
import { analyzeImageForAdWithGoogleVision } from './ocrAdDetector.js';

const logger = createLogger('BlogAdDetector');

// OCR 기반 광고 분석으로 전환됨 - 아래 키워드들은 ocrAdDetector.js에서 관리됨

/**
 * 이미지에서 광고 관련 콘텐츠 검출 (Google Vision 종합 분석 사용)
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<Object>} 분석 결과
 */
export async function analyzeImageForAd(imageUrl, retryCount = 0) {
  try {
    logger.info('이미지 광고 분석 시작 (Google Vision 종합):', imageUrl);

    // Google Vision 종합 분석 사용 (텍스트 + 라벨 + 로고 + 웹 엔터티)
    const result = await analyzeImageForAdWithGoogleVision(imageUrl);
    
    if (!result.success) {
      logger.error('Google Vision 이미지 분석 실패:', result.error);
      return {
        success: false,
        isAd: false,
        confidence: 0,
        error: result.error
      };
    }

    logger.info('Google Vision 종합 이미지 분석 완료:', {
      isAd: result.isAd,
      confidence: result.confidence,
      textKeywords: result.analysisDetails?.text?.adKeywords?.slice(0, 3),
      detectedLogos: result.analysisDetails?.logos?.detected?.map(l => l.description).slice(0, 2),
      commercialLabels: result.analysisDetails?.labels?.commercial?.map(l => l.description).slice(0, 3),
      webEntities: result.analysisDetails?.web?.entities?.map(e => e.description).slice(0, 2)
    });

    return {
      success: true,
      isAd: result.isAd,
      confidence: result.confidence,
      detectedKeywords: result.detectedKeywords,
      reason: result.reason,
      adType: result.isAd ? 'detected' : 'none',
      imageType: 'google_vision_analyzed',
      visionAnalysis: result.analysisDetails
    };

  } catch (error) {
    logger.error('이미지 광고 분석 실패:', error.message);
    
    // 에러 발생 시 재시도 (Google Vision API 일시적 오류 대응)
    if (retryCount < 2) {
      logger.warn(`Google Vision 분석 재시도 (${retryCount + 1}/2):`, error.message);
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
      return analyzeImageForAd(imageUrl, retryCount + 1);
    }
    
    return {
      success: false,
      isAd: false,
      confidence: 0,
      error: error.message
    };
  }
}

/**
 * 텍스트에서 광고 관련 키워드 검출 (비활성화됨)
 * 이미지 중심 분석으로 전환되어 더 이상 사용되지 않음
 * @param {string} text - 분석할 텍스트
 * @returns {Object} 분석 결과 (비활성화 상태)
 */
export function analyzeTextForAd(text) {
  // 텍스트 분석 완전 비활성화
  return {
    isAd: false,
    confidence: 0,
    detectedKeywords: [],
    reason: '텍스트 분석이 비활성화됨 (이미지 중심 분석으로 전환)'
  };
}

/**
 * 블로그 리뷰 광고 여부 종합 분석 (Google Vision 기반)
 * @param {Object} review - 리뷰 객체
 * @param {Object} socketIO - Socket.IO 인스턴스 (진행률 업데이트용, 선택사항)
 * @returns {Promise<Object>} 분석 결과
 */
export async function detectBlogAd(review, socketIO = null) {
  const analysisLogger = createLogger(`BlogAdAnalysis-${review.id}`);
  
  try {
    analysisLogger.info(`=== 블로그 리뷰 광고 분석 시작 (Google Vision 기반) ===`);
    analysisLogger.info(`리뷰 ID: ${review.id}`);
    analysisLogger.info(`블로그 제목: "${review.title}"`);
    // 분석 시작 로그
    analysisLogger.info(`🚀 블로그 광고 분석 시작 (Google Vision API 기반)`);
    analysisLogger.info(`📊 분석 대상 블로그 정보:`);
    analysisLogger.info(`   - 제목: "${review.title}"`);
    analysisLogger.info(`   - URL: ${review.url || 'N/A'}`);
    analysisLogger.info(`   - 작성자: ${review.author || 'N/A'}`);
    analysisLogger.info(`   - 플랫폼: ${review.platform_type || 'N/A'}`);
    analysisLogger.info(`   - 내용 미리보기: "${(review.content || '').substring(0, 100)}${(review.content || '').length > 100 ? '...' : ''}"`);
    analysisLogger.info(`   - 이미지 개수: ${review.images?.length || 0}개`);
    analysisLogger.info(`   - 분석 시각: ${new Date().toLocaleString('ko-KR')}`);
    analysisLogger.info(`==========================================`);
    
    analysisLogger.info(`블로그 URL: ${review.url || '정보 없음'}`);
    analysisLogger.info(`작성자: ${review.author || '익명'}`);
    analysisLogger.info(`작성일: ${review.date ? new Date(review.date).toLocaleDateString('ko-KR') : '정보 없음'}`);
    if (review.content) {
      analysisLogger.info(`블로그 내용 미리보기: "${review.content.substring(0, 100)}..."`);
    }

    const results = {
      reviewId: review.id,
      isAd: false,
      confidence: 0,
      analysis: {
        text: null, // 텍스트 분석 비활성화
        images: [],
        summary: {
          textScore: 0,
          imageScore: 0,
          bestImageIndex: -1,
          detectionDetails: []
        }
      },
      finalReason: ''
    };

    // 진행률 알림: 분석 시작
    if (socketIO) {
      socketIO.emit('adAnalysisProgress', {
        reviewId: review.id,
        stage: 'start',
        progress: 0,
        message: '광고 분석 시작...',
        timestamp: new Date().toISOString()
      });
    }

    // 텍스트 분석 건너뛰기
    analysisLogger.info(`📝 텍스트 분석: 비활성화됨 (Google Vision 이미지 중심 분석)`);

    // 이미지 분석 - Google Vision 종합 분석
    analysisLogger.info(`🖼️ === 이미지 분석 시작 (Google Vision 종합) ===`);
    if (review.images && review.images.length > 0) {
      analysisLogger.info(`📷 블로그 "${review.title}"에서 추출된 이미지: 총 ${review.images.length}개`);
      
      // 모든 이미지 URL 미리보기
      review.images.forEach((imageUrl, index) => {
        const urlPreview = imageUrl.length > 80 ? 
          imageUrl.substring(0, 80) + '...' : imageUrl;
        analysisLogger.info(`  - ${index + 1}번째 이미지: ${urlPreview}`);
      });
      
      // 진행률 알림: 이미지 분석 시작
      if (socketIO) {
        socketIO.emit('adAnalysisProgress', {
          reviewId: review.id,
          stage: 'image_analysis',
          progress: 20,
          message: `${review.images.length}개 이미지 분석 시작...`,
          totalImages: review.images.length,
          timestamp: new Date().toISOString()
        });
      }
      
      // 블로그 구조 분석: 첫 번째는 프로필, 두 번째부터 본문 이미지
      if (review.images.length === 1) {
        // 이미지가 1개뿐인 경우
        analysisLogger.info(`📌 블로그 구조 분석: 이미지 1개만 존재`);
        analysisLogger.info(`   → 프로필 이미지 또는 본문 이미지일 가능성 (판별 어려움)`);
        
        const singleImage = review.images[0];
        const imagePreview = singleImage.length > 100 ? 
          singleImage.substring(0, 100) + '...' : singleImage;
        
        analysisLogger.info(`🔍 1번째 이미지 분석 시작:`);
        analysisLogger.info(`   - 블로그 제목: "${review.title}"`);
        analysisLogger.info(`   - 블로그 URL: ${review.url || 'N/A'}`);
        analysisLogger.info(`   - 작성자: ${review.author || 'N/A'}`);
        analysisLogger.info(`   - 플랫폼: ${review.platform_type || 'N/A'}`);
        analysisLogger.info(`   - 이미지 URL: ${imagePreview}`);
        analysisLogger.info(`   - 이미지 순서: 1번째 (총 ${review.images.length}개 중)`);
        analysisLogger.info(`   - 분석 방법: Google Vision API (텍스트+로고+라벨+웹엔터티)`);
        
        // 진행률 알림: 단일 이미지 분석
        if (socketIO) {
          socketIO.emit('adAnalysisProgress', {
            reviewId: review.id,
            stage: 'analyzing_image',
            progress: 50,
            message: '이미지 분석 중... (Google Vision 4가지 기능 활용)',
            currentImage: 1,
            totalImages: 1,
            timestamp: new Date().toISOString()
          });
        }
        
        const imageResult = await analyzeImageForAd(singleImage);
        imageResult.imageIndex = 0;
        imageResult.isProfileImage = true;
        imageResult.blogInfo = {
          title: review.title,
          url: review.url,
          author: review.author,
          platform: review.platform_type
        };
        results.analysis.images.push(imageResult);
        
        analysisLogger.info(`✅ 1번째 이미지 분석 완료:`);
        analysisLogger.info(`   - 블로그 제목: "${review.title}"`);
        analysisLogger.info(`   - 블로그 URL: ${review.url || 'N/A'}`);
        analysisLogger.info(`   - 이미지 URL: ${imagePreview}`);
        analysisLogger.info(`   - 이미지 유형: 프로필 또는 본문 (불확실)`);
        analysisLogger.info(`   - 광고 여부: ${imageResult.isAd ? '🔴 광고' : '🟢 일반'}`);
        analysisLogger.info(`   - 원본 신뢰도: ${imageResult.confidence}%`);
        
        if (imageResult.visionAnalysis) {
          const va = imageResult.visionAnalysis;
          analysisLogger.info(`   - Google Vision 상세 분석 결과:`);
          
          // 텍스트 분석 결과
          if (va.text) {
            analysisLogger.info(`     * 텍스트 분석:`);
            analysisLogger.info(`       - 전체 텍스트: "${va.text.fullText?.substring(0, 100) || 'N/A'}${va.text.fullText?.length > 100 ? '...' : ''}"`);
            analysisLogger.info(`       - 광고 키워드 발견: ${va.text.adKeywords?.length || 0}개`);
            if (va.text.adKeywords?.length > 0) {
              analysisLogger.info(`       - 발견된 키워드: [${va.text.adKeywords.slice(0, 5).join(', ')}]`);
            }
            analysisLogger.info(`       - 텍스트 점수: ${va.text.score || 0}점`);
          }
          
          // 로고 분석 결과
          if (va.logos) {
            analysisLogger.info(`     * 로고 분석:`);
            analysisLogger.info(`       - 감지된 로고: ${va.logos.count || 0}개`);
            if (va.logos.detected?.length > 0) {
              va.logos.detected.slice(0, 3).forEach((logo, index) => {
                analysisLogger.info(`       - 로고 ${index + 1}: ${logo.description} (신뢰도: ${(logo.score * 100).toFixed(1)}%)`);
              });
            }
            analysisLogger.info(`       - 로고 점수: ${va.logos.score || 0}점`);
          }
          
          // 라벨 분석 결과
          if (va.labels) {
            analysisLogger.info(`     * 라벨 분석:`);
            analysisLogger.info(`       - 상업적 라벨: ${va.labels.commercial?.length || 0}개`);
            if (va.labels.commercial?.length > 0) {
              analysisLogger.info(`       - 상업 라벨: [${va.labels.commercial.slice(0, 3).map(l => `${l.description}(${(l.score * 100).toFixed(1)}%)`).join(', ')}]`);
            }
            analysisLogger.info(`       - 라벨 점수: ${va.labels.score || 0}점`);
          }
          
          // 웹 엔터티 분석 결과
          if (va.web) {
            analysisLogger.info(`     * 웹 엔터티 분석:`);
            analysisLogger.info(`       - 웹 엔터티: ${va.web.entities?.length || 0}개`);
            if (va.web.entities?.length > 0) {
              analysisLogger.info(`       - 주요 엔터티: [${va.web.entities.slice(0, 3).map(e => `${e.description}(${(e.score * 100).toFixed(1)}%)`).join(', ')}]`);
            }
            analysisLogger.info(`       - 웹 점수: ${va.web.score || 0}점`);
          }
          
          analysisLogger.info(`     * 종합 점수: ${(va.text?.score || 0) + (va.logos?.score || 0) + (va.labels?.score || 0) + (va.web?.score || 0)}점`);
        }
        
        // 단일 이미지의 경우 프로필일 가능성이 높으므로 신뢰도를 낮춤
        const originalConfidence = imageResult.confidence;
        imageResult.confidence = Math.round(imageResult.confidence * 0.6);
        
        analysisLogger.info(`   - 단일 이미지 보정: ${originalConfidence}% → ${imageResult.confidence}% (프로필 가능성 고려)`);
        analysisLogger.info(`   - 최종 판정: ${imageResult.isAd ? '🔴 광고' : '🟢 일반'} (${imageResult.confidence}%)`);
        
        if (imageResult.isAd) {
          analysisLogger.info(`   - 광고 판정 근거: ${imageResult.reason}`);
          if (imageResult.detectedKeywords?.length > 0) {
            analysisLogger.info(`   - 발견된 키워드: [${imageResult.detectedKeywords.join(', ')}]`);
          }
          
          results.analysis.summary.detectionDetails.push({
            type: 'image',
            imageIndex: 0,
            reason: `${imageResult.reason} (단일 이미지 - 프로필 가능성으로 신뢰도 보정)`,
            keywords: imageResult.detectedKeywords || [],
            confidence: imageResult.confidence
          });
        }
        
        // 진행률 알림: 이미지 분석 완료
        if (socketIO) {
          socketIO.emit('adAnalysisProgress', {
            reviewId: review.id,
            stage: 'image_complete',
            progress: 80,
            message: '이미지 분석 완료',
            currentImage: 1,
            totalImages: 1,
            timestamp: new Date().toISOString()
          });
        }
        
      } else if (review.images.length >= 2) {
        // 2개 이상인 경우 - 첫 번째는 프로필, 두 번째부터 본문 (최대 2개만 분석)
        analysisLogger.info(`📌 블로그 구조 분석: 이미지 ${review.images.length}개 (본문 1-2번째만 분석)`);
        analysisLogger.info(`   → 1번째: 프로필 이미지 (분석 제외)`);
        analysisLogger.info(`   → 2번째: 본문 첫 번째 이미지 (🎯 중점 분석)`);
        if (review.images.length >= 3) {
          analysisLogger.info(`   → 3번째: 본문 두 번째 이미지 (추가 분석)`);
        }
        if (review.images.length >= 4) {
          analysisLogger.info(`   → 4번째 이후: 분석 생략 (성능 최적화)`);
        }
        
        // 진행률 알림: 본문 첫 번째 이미지 분석 시작
        if (socketIO) {
          socketIO.emit('adAnalysisProgress', {
            reviewId: review.id,
            stage: 'analyzing_main_image',
            progress: 40,
            message: '본문 첫 번째 이미지 분석 중... (Google Vision 종합)',
            currentImage: 2,
            totalImages: Math.min(3, review.images.length), // 최대 3개까지만 표시 (프로필 제외하고 본문 2개)
            timestamp: new Date().toISOString()
          });
        }
        
        // 두 번째 이미지 (본문 첫 번째) - 가장 중요한 이미지
        const secondImage = review.images[1];
        const imagePreview = secondImage.length > 100 ? 
          secondImage.substring(0, 100) + '...' : secondImage;
        
        analysisLogger.info(`🔍 2번째 이미지(본문 1번째) 분석 시작:`);
        analysisLogger.info(`   - 블로그 제목: "${review.title}"`);
        analysisLogger.info(`   - 블로그 URL: ${review.url || 'N/A'}`);
        analysisLogger.info(`   - 작성자: ${review.author || 'N/A'}`);
        analysisLogger.info(`   - 플랫폼: ${review.platform_type || 'N/A'}`);
        analysisLogger.info(`   - 이미지 URL: ${imagePreview}`);
        analysisLogger.info(`   - 이미지 순서: 2번째 (총 ${review.images.length}개 중)`);
        analysisLogger.info(`   - 우선순위: 🎯 최우선 (광고 표시가 가장 자주 나타나는 위치)`);
        analysisLogger.info(`   - 분석 방법: Google Vision API (텍스트+로고+라벨+웹엔터티)`);
        
        const secondImageResult = await analyzeImageForAd(secondImage);
        secondImageResult.imageIndex = 1;
        secondImageResult.isMainContent = true;
        secondImageResult.priority = 'high'; // 최우선 분석 대상
        secondImageResult.blogInfo = {
          title: review.title,
          url: review.url,
          author: review.author,
          platform: review.platform_type
        };
        
        // 본문 첫 번째 이미지는 신뢰도 부스팅 (광고 표시가 가장 자주 나타나는 위치)
        const originalSecondConfidence = secondImageResult.confidence;
        if (secondImageResult.isAd && secondImageResult.confidence >= 60) {
          secondImageResult.confidence = Math.min(100, Math.round(secondImageResult.confidence * 1.2));
          analysisLogger.info(`   - 본문 첫 번째 이미지 신뢰도 부스팅: ${originalSecondConfidence}% → ${secondImageResult.confidence}%`);
        }
        
        results.analysis.images.push(secondImageResult);
        
        analysisLogger.info(`✅ 2번째 이미지 분석 완료:`);
        analysisLogger.info(`   - 블로그 제목: "${review.title}"`);
        analysisLogger.info(`   - 블로그 URL: ${review.url || 'N/A'}`);
        analysisLogger.info(`   - 이미지 URL: ${imagePreview}`);
        analysisLogger.info(`   - 이미지 순서: 2번째 (총 ${review.images.length}개 중)`);
        analysisLogger.info(`   - 이미지 유형: 본문 첫 번째 (🎯 최우선 분석 대상)`);
        analysisLogger.info(`   - 광고 여부: ${secondImageResult.isAd ? '🔴 광고' : '🟢 일반'}`);
        analysisLogger.info(`   - 최종 신뢰도: ${secondImageResult.confidence}%`);
        
        if (secondImageResult.visionAnalysis) {
          const va = secondImageResult.visionAnalysis;
          analysisLogger.info(`   - Google Vision 상세 분석 결과:`);
          
          // 텍스트 분석 결과
          if (va.text) {
            analysisLogger.info(`     * 텍스트 분석:`);
            analysisLogger.info(`       - 전체 텍스트: "${va.text.fullText?.substring(0, 100) || 'N/A'}${va.text.fullText?.length > 100 ? '...' : ''}"`);
            analysisLogger.info(`       - 광고 키워드 발견: ${va.text.adKeywords?.length || 0}개`);
            if (va.text.adKeywords?.length > 0) {
              analysisLogger.info(`       - 발견된 키워드: [${va.text.adKeywords.slice(0, 5).join(', ')}]`);
            }
            analysisLogger.info(`       - 텍스트 점수: ${va.text.score || 0}점`);
          }
          
          // 로고 분석 결과
          if (va.logos) {
            analysisLogger.info(`     * 로고 분석:`);
            analysisLogger.info(`       - 감지된 로고: ${va.logos.count || 0}개`);
            if (va.logos.detected?.length > 0) {
              va.logos.detected.slice(0, 3).forEach((logo, index) => {
                analysisLogger.info(`       - 로고 ${index + 1}: ${logo.description} (신뢰도: ${(logo.score * 100).toFixed(1)}%)`);
              });
            }
            analysisLogger.info(`       - 로고 점수: ${va.logos.score || 0}점`);
          }
          
          // 라벨 분석 결과
          if (va.labels) {
            analysisLogger.info(`     * 라벨 분석:`);
            analysisLogger.info(`       - 상업적 라벨: ${va.labels.commercial?.length || 0}개`);
            if (va.labels.commercial?.length > 0) {
              analysisLogger.info(`       - 상업 라벨: [${va.labels.commercial.slice(0, 3).map(l => `${l.description}(${(l.score * 100).toFixed(1)}%)`).join(', ')}]`);
            }
            analysisLogger.info(`       - 라벨 점수: ${va.labels.score || 0}점`);
          }
          
          // 웹 엔터티 분석 결과
          if (va.web) {
            analysisLogger.info(`     * 웹 엔터티 분석:`);
            analysisLogger.info(`       - 웹 엔터티: ${va.web.entities?.length || 0}개`);
            if (va.web.entities?.length > 0) {
              analysisLogger.info(`       - 주요 엔터티: [${va.web.entities.slice(0, 3).map(e => `${e.description}(${(e.score * 100).toFixed(1)}%)`).join(', ')}]`);
            }
            analysisLogger.info(`       - 웹 점수: ${va.web.score || 0}점`);
          }
          
          analysisLogger.info(`     * 종합 점수: ${(va.text?.score || 0) + (va.logos?.score || 0) + (va.labels?.score || 0) + (va.web?.score || 0)}점`);
        }
        
        if (secondImageResult.detectedKeywords?.length > 0) {
          analysisLogger.info(`   - 발견된 키워드: [${secondImageResult.detectedKeywords.join(', ')}]`);
        }
        
        if (secondImageResult.isAd) {
          analysisLogger.info(`   - 🔴 광고 판정 근거: ${secondImageResult.reason}`);
          
          results.analysis.summary.detectionDetails.push({
            type: 'image',
            imageIndex: 1,
            reason: `${secondImageResult.reason} (본문 첫 번째 이미지 - 우선 분석)`,
            keywords: secondImageResult.detectedKeywords || [],
            confidence: secondImageResult.confidence
          });
        } else {
          analysisLogger.info(`   - 🟢 일반 글 판정: 명확한 광고 요소 미발견`);
        }
        
        // 진행률 알림: 본문 첫 번째 이미지 완료
        if (socketIO) {
          socketIO.emit('adAnalysisProgress', {
            reviewId: review.id,
            stage: 'main_image_complete',
            progress: 60,
            message: `본문 첫 번째 이미지 완료: ${secondImageResult.isAd ? '광고' : '일반'} (${secondImageResult.confidence}%)`,
            currentImage: 2,
            totalImages: Math.min(3, review.images.length),
            result: {
              isAd: secondImageResult.isAd,
              confidence: secondImageResult.confidence,
              keywords: secondImageResult.detectedKeywords?.slice(0, 3)
            },
            timestamp: new Date().toISOString()
          });
        }
        
        // 세 번째 이미지가 있는 경우 (본문 두 번째) - 최대 2개까지만 분석
        if (review.images.length >= 3) {
          // 진행률 알림: 본문 두 번째 이미지 분석 시작
          if (socketIO) {
            socketIO.emit('adAnalysisProgress', {
              reviewId: review.id,
              stage: 'analyzing_second_image',
              progress: 70,
              message: '본문 두 번째 이미지 분석 중...',
              currentImage: 3,
              totalImages: Math.min(3, review.images.length),
              timestamp: new Date().toISOString()
            });
          }
          
          const thirdImage = review.images[2];
          const thirdImagePreview = thirdImage.length > 100 ? 
            thirdImage.substring(0, 100) + '...' : thirdImage;
          
          analysisLogger.info(`🔍 3번째 이미지(본문 2번째) 분석 시작:`);
          analysisLogger.info(`   - 블로그 제목: "${review.title}"`);
          analysisLogger.info(`   - 블로그 URL: ${review.url || 'N/A'}`);
          analysisLogger.info(`   - 작성자: ${review.author || 'N/A'}`);
          analysisLogger.info(`   - 플랫폼: ${review.platform_type || 'N/A'}`);
          analysisLogger.info(`   - 이미지 URL: ${thirdImagePreview}`);
          analysisLogger.info(`   - 이미지 순서: 3번째 (총 ${review.images.length}개 중)`);
          analysisLogger.info(`   - 우선순위: 🟡 중간 (보조 분석 대상)`);
          analysisLogger.info(`   - 분석 방법: Google Vision API (텍스트+로고+라벨+웹엔터티)`);
          
          const thirdImageResult = await analyzeImageForAd(thirdImage);
          thirdImageResult.imageIndex = 2;
          thirdImageResult.isMainContent = true;
          thirdImageResult.priority = 'medium'; // 중간 우선순위
          thirdImageResult.blogInfo = {
            title: review.title,
            url: review.url,
            author: review.author,
            platform: review.platform_type
          };
          
          // 본문 두 번째 이미지도 약간의 신뢰도 부스팅 적용
          if (thirdImageResult.isAd && thirdImageResult.confidence >= 50) {
            const originalConfidence = thirdImageResult.confidence;
            thirdImageResult.confidence = Math.min(100, Math.round(thirdImageResult.confidence * 1.1));
            analysisLogger.info(`본문 두 번째 이미지 신뢰도 부스팅: ${originalConfidence}% → ${thirdImageResult.confidence}%`);
          }
          
          results.analysis.images.push(thirdImageResult);
          
          analysisLogger.info(`✅ 3번째 이미지 분석 완료:`);
          analysisLogger.info(`   - 블로그 제목: "${review.title}"`);
          analysisLogger.info(`   - 블로그 URL: ${review.url || 'N/A'}`);
          analysisLogger.info(`   - 이미지 URL: ${thirdImagePreview}`);
          analysisLogger.info(`   - 이미지 순서: 3번째 (총 ${review.images.length}개 중)`);
          analysisLogger.info(`   - 이미지 유형: 본문 두 번째 (🟡 보조 분석 대상)`);
          analysisLogger.info(`   - 광고 여부: ${thirdImageResult.isAd ? '🔴 광고' : '🟢 일반'}`);
          analysisLogger.info(`   - 최종 신뢰도: ${thirdImageResult.confidence}%`);
          
          if (thirdImageResult.visionAnalysis) {
            const va = thirdImageResult.visionAnalysis;
            analysisLogger.info(`   - Google Vision 상세 분석 결과:`);
            
            // 텍스트 분석 결과
            if (va.text) {
              analysisLogger.info(`     * 텍스트 분석:`);
              analysisLogger.info(`       - 전체 텍스트: "${va.text.fullText?.substring(0, 100) || 'N/A'}${va.text.fullText?.length > 100 ? '...' : ''}"`);
              analysisLogger.info(`       - 광고 키워드 발견: ${va.text.adKeywords?.length || 0}개`);
              if (va.text.adKeywords?.length > 0) {
                analysisLogger.info(`       - 발견된 키워드: [${va.text.adKeywords.slice(0, 5).join(', ')}]`);
              }
              analysisLogger.info(`       - 텍스트 점수: ${va.text.score || 0}점`);
            }
            
            // 로고 분석 결과
            if (va.logos) {
              analysisLogger.info(`     * 로고 분석:`);
              analysisLogger.info(`       - 감지된 로고: ${va.logos.count || 0}개`);
              if (va.logos.detected?.length > 0) {
                va.logos.detected.slice(0, 3).forEach((logo, index) => {
                  analysisLogger.info(`       - 로고 ${index + 1}: ${logo.description} (신뢰도: ${(logo.score * 100).toFixed(1)}%)`);
                });
              }
              analysisLogger.info(`       - 로고 점수: ${va.logos.score || 0}점`);
            }
            
            // 라벨 분석 결과
            if (va.labels) {
              analysisLogger.info(`     * 라벨 분석:`);
              analysisLogger.info(`       - 상업적 라벨: ${va.labels.commercial?.length || 0}개`);
              if (va.labels.commercial?.length > 0) {
                analysisLogger.info(`       - 상업 라벨: [${va.labels.commercial.slice(0, 3).map(l => `${l.description}(${(l.score * 100).toFixed(1)}%)`).join(', ')}]`);
              }
              analysisLogger.info(`       - 라벨 점수: ${va.labels.score || 0}점`);
            }
            
            // 웹 엔터티 분석 결과
            if (va.web) {
              analysisLogger.info(`     * 웹 엔터티 분석:`);
              analysisLogger.info(`       - 웹 엔터티: ${va.web.entities?.length || 0}개`);
              if (va.web.entities?.length > 0) {
                analysisLogger.info(`       - 주요 엔터티: [${va.web.entities.slice(0, 3).map(e => `${e.description}(${(e.score * 100).toFixed(1)}%)`).join(', ')}]`);
              }
              analysisLogger.info(`       - 웹 점수: ${va.web.score || 0}점`);
            }
            
            analysisLogger.info(`     * 종합 점수: ${(va.text?.score || 0) + (va.logos?.score || 0) + (va.labels?.score || 0) + (va.web?.score || 0)}점`);
          }
          
          if (thirdImageResult.detectedKeywords?.length > 0) {
            analysisLogger.info(`   - 발견된 키워드: [${thirdImageResult.detectedKeywords.join(', ')}]`);
          }
          
          if (thirdImageResult.isAd) {
            results.analysis.summary.detectionDetails.push({
              type: 'image',
              imageIndex: 2,
              reason: `${thirdImageResult.reason} (본문 두 번째 이미지)`,
              keywords: thirdImageResult.detectedKeywords || [],
              confidence: thirdImageResult.confidence
            });
          }
          
          // 진행률 알림: 본문 두 번째 이미지 완료
          if (socketIO) {
            socketIO.emit('adAnalysisProgress', {
              reviewId: review.id,
              stage: 'second_image_complete',
              progress: 80,
              message: `본문 두 번째 이미지 완료: ${thirdImageResult.isAd ? '광고' : '일반'} (${thirdImageResult.confidence}%)`,
              currentImage: 3,
              totalImages: Math.min(3, review.images.length),
              result: {
                isAd: thirdImageResult.isAd,
                confidence: thirdImageResult.confidence,
                keywords: thirdImageResult.detectedKeywords?.slice(0, 3)
              },
              timestamp: new Date().toISOString()
            });
          }
        }
        
        // 4번째 이미지 이후는 분석하지 않음 (성능 최적화)
        if (review.images.length >= 4) {
          analysisLogger.info(`4번째 이후 ${review.images.length - 3}개 이미지는 분석 생략 (성능 최적화)`);
        }
        
        // 진행률 알림: 이미지 분석 완료
        if (socketIO) {
          socketIO.emit('adAnalysisProgress', {
            reviewId: review.id,
            stage: 'images_complete',
            progress: 85,
            message: '이미지 분석 완료 (최대 2개 본문 이미지 분석)',
            analyzedImages: results.analysis.images.length,
            totalImages: review.images.length,
            timestamp: new Date().toISOString()
          });
        }
      }
    } else {
      analysisLogger.info(`이미지가 없음 - 분석 불가`);
    }

    // 종합 판단 (이미지만으로) - 본문 이미지 우선순위 강화
    analysisLogger.info(`⚖️ 종합 판단 (이미지 기반 - 본문 이미지 우선)`);
    
    let bestImageScore = 0;
    let bestImageIndex = -1;
    let hasAdImage = false;
    let primaryContentScore = 0; // 본문 첫 번째 이미지 점수 (최우선)
    let secondaryContentScore = 0; // 본문 두 번째 이미지 점수 (차선)
    let profileImageScore = 0; // 프로필 이미지 점수 (낮은 우선순위)
    
    if (results.analysis.images.length > 0) {
      for (let i = 0; i < results.analysis.images.length; i++) {
        const imageResult = results.analysis.images[i];
        
        // 전체 최고 점수 추적
        if (imageResult.confidence > bestImageScore) {
          bestImageScore = imageResult.confidence;
          bestImageIndex = imageResult.imageIndex;
        }
        
        // 이미지 유형별 점수 분류
        if (imageResult.isMainContent && imageResult.priority === 'high') {
          // 본문 첫 번째 이미지 (최우선)
          primaryContentScore = Math.max(primaryContentScore, imageResult.confidence);
        } else if (imageResult.isMainContent && imageResult.priority === 'medium') {
          // 본문 두 번째 이미지
          secondaryContentScore = Math.max(secondaryContentScore, imageResult.confidence);
        } else if (imageResult.isMainContent) {
          // 기타 본문 이미지
          secondaryContentScore = Math.max(secondaryContentScore, imageResult.confidence);
        } else {
          // 프로필 이미지 또는 기타
          profileImageScore = Math.max(profileImageScore, imageResult.confidence);
        }
        
        if (imageResult.isAd) {
          hasAdImage = true;
        }
      }
      
      analysisLogger.info(`이미지 분석 종합:`);
      analysisLogger.info(`- 본문 첫 번째 이미지: ${primaryContentScore}% (최우선)`);
      analysisLogger.info(`- 본문 두 번째 이미지: ${secondaryContentScore}% (차선)`);
      analysisLogger.info(`- 프로필/기타 이미지: ${profileImageScore}% (낮은 우선순위)`);
      analysisLogger.info(`- 전체 최고 점수: ${bestImageScore}% (${bestImageIndex + 1}번째 이미지)`);
      analysisLogger.info(`- 광고 이미지 발견: ${hasAdImage ? 'Yes' : 'No'}`);
    }
    
    // 점수 계산 (우선순위 기반 계산)
    let totalScore;
    let scoreCalculation;
    
    if (primaryContentScore > 0) {
      // 본문 첫 번째 이미지 점수가 가장 중요 (가중치 1.0)
      totalScore = primaryContentScore;
      scoreCalculation = `본문 1번째 이미지: ${primaryContentScore}% (최우선)`;
      
      // 본문 두 번째 이미지가 더 높은 경우 보조적으로 고려
      if (secondaryContentScore > primaryContentScore) {
        totalScore = Math.max(primaryContentScore, secondaryContentScore * 0.9);
        scoreCalculation = `본문 2번째 이미지: ${secondaryContentScore}% × 0.9 = ${(secondaryContentScore * 0.9).toFixed(1)}% (1번째보다 높음)`;
      }
      
    } else if (secondaryContentScore > 0) {
      // 본문 두 번째 이미지만 있는 경우 (가중치 0.95)
      totalScore = secondaryContentScore * 0.95;
      scoreCalculation = `본문 2번째 이미지: ${secondaryContentScore}% × 0.95 = ${totalScore.toFixed(1)}%`;
      
    } else if (profileImageScore > 0) {
      // 프로필 이미지만 있는 경우 (가중치 0.5)
      totalScore = profileImageScore * 0.5;
      scoreCalculation = `프로필/기타 이미지: ${profileImageScore}% × 0.5 = ${totalScore.toFixed(1)}% (낮은 신뢰도)`;
      
    } else {
      totalScore = 0;
      scoreCalculation = '분석 가능한 이미지 없음 = 0%';
    }
    
    analysisLogger.info(`점수 계산 (우선순위 반영): ${scoreCalculation}`);
    
    results.analysis.summary.imageScore = totalScore;
    results.analysis.summary.bestImageIndex = bestImageIndex;
    results.confidence = Math.round(totalScore);
    
    // 임계값 조정: 본문 이미지 기반이므로 더 엄격하게
    if (primaryContentScore > 0) {
      results.isAd = results.confidence >= 45; // 본문 첫 번째 이미지는 45% 이상
    } else if (secondaryContentScore > 0) {
      results.isAd = results.confidence >= 50; // 본문 두 번째 이미지는 50% 이상
    } else {
      results.isAd = results.confidence >= 35; // 기타 이미지는 35% 이상
    }
    
    // 플랫폼 타입에 따른 조정 적용
    const adjustedResults = adjustResultByPlatformType(review, results);
    results.confidence = adjustedResults.confidence;
    results.isAd = adjustedResults.isAd;
    results.finalReason = adjustedResults.reason;
    
    if (results.isAd) {
      const reasons = [];
      if (hasAdImage) {
        const primaryAdImage = results.analysis.images.find(img => img.isMainContent && img.priority === 'high' && img.isAd);
        const secondaryAdImage = results.analysis.images.find(img => img.isMainContent && img.priority === 'medium' && img.isAd);
        const otherAdImage = results.analysis.images.find(img => img.isMainContent && img.isAd);
        
        if (primaryAdImage) {
          reasons.push('본문 첫 번째 이미지에서 광고 표시 발견');
        } else if (secondaryAdImage) {
          reasons.push('본문 두 번째 이미지에서 광고 표시 발견');
        } else if (otherAdImage) {
          reasons.push('본문 이미지에서 광고 표시 발견');
        } else {
          reasons.push('이미지에서 광고 표시 발견');
        }
      }
      results.finalReason = reasons.length > 0 ? reasons.join(' + ') : '이미지 광고 요소 감지됨';
    } else {
      results.finalReason = '본문 이미지에서 명확한 광고 요소가 발견되지 않음';
    }

    analysisLogger.info(`✅ Google Vision 광고 분석 완료:`);
    analysisLogger.info(`📊 최종 분석 결과 요약:`);
    analysisLogger.info(`   - 블로그 제목: "${review.title}"`);
    analysisLogger.info(`   - 블로그 URL: ${review.url || 'N/A'}`);
    analysisLogger.info(`   - 광고 여부: ${results.isAd ? '🔴 광고' : '🟢 일반'}`);
    analysisLogger.info(`   - 최종 신뢰도: ${results.confidence}%`);
    analysisLogger.info(`   - 판단 근거: ${results.finalReason}`);
    analysisLogger.info(`   - 분석된 이미지: ${results.analysis.images.length}개`);
    if (results.analysis.images.length > 0) {
      results.analysis.images.forEach((img, index) => {
        analysisLogger.info(`     * ${index + 1}번째 이미지: ${img.isAd ? '광고' : '일반'} (${img.confidence}%) - ${img.priority || 'low'} 우선순위`);
      });
    }
    analysisLogger.info(`   - 분석 완료 시각: ${new Date().toLocaleString('ko-KR')}`);
    analysisLogger.info(`=== 분석 완료 ===`);

    // 진행률 알림: 분석 완료
    if (socketIO) {
      socketIO.emit('adAnalysisProgress', {
        reviewId: review.id,
        stage: 'complete',
        progress: 100,
        message: `분석 완료: ${results.isAd ? '광고' : '일반'} (${results.confidence}%)`,
        finalResult: {
          isAd: results.isAd,
          confidence: results.confidence,
          reason: results.finalReason,
          keywords: results.analysis.summary.detectionDetails.reduce((acc, detail) => [...acc, ...detail.keywords], []).slice(0, 5)
        },
        timestamp: new Date().toISOString()
      });
    }

    return {
      ...results,
      blogInfo: {
        title: review.title,
        url: review.url,
        author: review.author,
        platform: review.platform_type,
        analyzedAt: new Date().toISOString()
      }
    };

  } catch (error) {
    analysisLogger.error(`❌ 블로그 광고 분석 중 오류 발생:`);
    analysisLogger.error(`   - 블로그 제목: "${review.title}"`);
    analysisLogger.error(`   - 블로그 URL: ${review.url || 'N/A'}`);
    analysisLogger.error(`   - 오류 메시지: ${error.message}`);
    analysisLogger.error(`   - 오류 발생 시각: ${new Date().toLocaleString('ko-KR')}`);
    analysisLogger.error(`   - 스택 트레이스: ${error.stack}`);
    
    // 진행률 알림: 오류 발생
    if (socketIO) {
      socketIO.emit('adAnalysisProgress', {
        reviewId: review.id,
        stage: 'error',
        progress: 0,
        message: `분석 실패: ${error.message}`,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
    
    return {
      reviewId: review.id,
      isAd: false,
      confidence: 0,
      error: error.message,
      finalReason: '분석 중 오류 발생',
      blogInfo: {
        title: review.title,
        url: review.url,
        author: review.author,
        platform: review.platform_type
      }
    };
  }
}

/**
 * 플랫폼 타입에 따른 광고 감지 로직 조정
 * @param {Object} review - 리뷰 객체
 * @param {Object} baseResult - 기본 분석 결과
 * @returns {Object} 조정된 분석 결과
 */
function adjustResultByPlatformType(review, baseResult) {
  const platformType = review.platform_type;
  
  if (platformType === 'cafe') {
    // 카페글의 경우 광고 임계값을 낮춤 (커뮤니티 특성상 광고가 적음)
    baseResult.confidence *= 0.8;
    baseResult.isAd = baseResult.confidence >= 25;
    
    // 카페 특유의 비광고 신호
    const cafeNonAdSignals = [
      /질문/gi, /문의/gi, /추천.*해주세요/gi, /어디.*좋을까/gi,
      /경험.*있으신분/gi, /정보.*공유/gi
    ];
    
    const text = `${review.title || ''} ${review.content || ''}`;
    cafeNonAdSignals.forEach(pattern => {
      if (text.match(pattern)) {
        baseResult.confidence -= 10;
        baseResult.reason += ' (카페 질문글 특성 고려)';
      }
    });
    
  } else if (platformType === 'blog') {
    // 블로그글의 경우 기본 로직 유지 (개인 블로그 광고 많음)
    // 블로그 특유의 광고 신호 강화
    const blogAdSignals = [
      /체험단/gi, /리뷰어/gi, /솔직후기/gi, /완전.*대박/gi,
      /강추/gi, /강력.*추천/gi, /정말.*좋아요/gi
    ];
    
    const text = `${review.title || ''} ${review.content || ''}`;
    blogAdSignals.forEach(pattern => {
      if (text.match(pattern)) {
        baseResult.confidence += 5;
        baseResult.reason += ' (블로그 광고 특성 고려)';
      }
    });
  }
  
  // 신뢰도는 0-100 범위로 제한
  baseResult.confidence = Math.min(Math.max(Math.round(baseResult.confidence), 0), 100);
  baseResult.isAd = baseResult.confidence >= 35;
  
  return baseResult;
}
