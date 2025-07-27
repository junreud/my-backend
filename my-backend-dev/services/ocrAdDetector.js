// services/googleVisionAdDetector.js
import 'dotenv/config';
import vision from '@google-cloud/vision';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('GoogleVisionAdDetector');

// Google Cloud Vision 클라이언트 초기화
let visionClient;

try {
  // 서비스 계정 키 파일이 있는 경우
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    visionClient = new vision.ImageAnnotatorClient();
    logger.info('Google Cloud Vision API 클라이언트 초기화 완료 (서비스 계정)');
  } 
  // API 키를 사용하는 경우
  else if (process.env.GOOGLE_CLOUD_API_KEY) {
    visionClient = new vision.ImageAnnotatorClient({
      apiKey: process.env.GOOGLE_CLOUD_API_KEY
    });
    logger.info('Google Cloud Vision API 클라이언트 초기화 완료 (API 키)');
  } 
  else {
    logger.warn('Google Cloud Vision API 인증 정보가 없습니다. 환경변수를 설정해주세요.');
    logger.warn('GOOGLE_APPLICATION_CREDENTIALS (서비스 계정 키 파일 경로) 또는');
    logger.warn('GOOGLE_CLOUD_API_KEY (API 키)를 설정하세요.');
  }
} catch (error) {
  logger.error('Google Cloud Vision API 클라이언트 초기화 실패:', error.message);
}

// 광고 관련 키워드 (한국어 + 영어) - 더욱 강화된 버전
const AD_KEYWORDS = {
  // 명시적 광고 표시 (가중치: 매우 높음) - 즉시 광고로 판단
  critical: [
    // 기본 광고 표시
    '광고', '협찬', '제공받았', '제공받은', '무료제공', '무료체험',
    '#광고', '#협찬', '#제공', '#무료체험', '#sponsored', '#ad',
    'sponsored', 'advertisement', 'provided by', 'gifted', 'pr',
    
    // 협찬 관련 확장
    '유료광고', '협찬광고', '제공광고', '협찬받아', '협찬받은',
    '협찬받았습니다', '제공받았습니다', '협찬을 받아', '협찬을 받고',
    '무료로 제공받았', '무료로 제공받은', '업체로부터 제공받은',
    '업체에서 제공받은', '브랜드로부터 제공받은', '브랜드에서 제공받은',
    
    // 체험단 관련
    '체험단으로', '체험단을', '체험단에', '리뷰어로', '서포터즈로',
    '앰버서더로', '인플루언서로', '모니터로', '모니터링',
    
    // 선정/선발 관련
    '선정되어', '선발되어', '당첨되어', '뽑혀서', '선택받아',
    
    // 제품/서비스 제공 관련
    '제품을 제공받아', '서비스를 제공받아', '체험 기회를 제공받아',
    '무료로 받았', '무료로 받은', '무료로 체험', '무료로 이용',
    
    // 영어 확장
    'complimentary', 'free sample', 'review product', 'trial product',
    'marketing collaboration', 'brand partnership', 'influencer program'
  ],
  
  // 강한 광고 신호 (가중치: 높음)
  strong: [
    '체험단', '서포터즈', '리뷰어', '앰버서더', '인플루언서', '모니터',
    'influencer', 'ambassador', 'collaboration', 'partnership',
    '브랜드협찬', '업체제공', '무료증정', '체험후기', '체험리뷰',
    '홍보대사', '브랜드파트너', '마케팅협력', '프로모션참여'
  ],
  
  // 약한 광고 신호 (가중치: 낮음)
  weak: [
    '홍보', '후원', '콜라보', '이벤트참여', '선물받았',
    'promotion', 'collab', 'complimentary', 'review',
    '체험', '증정', '제공', '이벤트당첨'
  ]
};

// 키워드 가중치 설정 (강화됨)
const KEYWORD_WEIGHTS = {
  critical: 100,  // 명시적 광고 표시 - 즉시 광고로 판단
  strong: 30,     // 강한 광고 신호
  weak: 15        // 약한 광고 신호
};

// 광고성 문구 패턴 (더욱 강화됨)
const AD_PATTERNS = [
  // 매우 강력한 패턴 (즉시 광고로 판단) - critical level
  { pattern: /#광고/gi, weight: 100, description: '해시태그 광고', critical: true },
  { pattern: /#협찬/gi, weight: 100, description: '해시태그 협찬', critical: true },
  { pattern: /#제공/gi, weight: 100, description: '해시태그 제공', critical: true },
  { pattern: /#sponsored/gi, weight: 100, description: '해시태그 sponsored', critical: true },
  { pattern: /#ad/gi, weight: 100, description: '해시태그 ad', critical: true },
  
  // 협찬 받은 표현들
  { pattern: /협찬.*받아.*작성/gi, weight: 100, description: '협찬받아 작성', critical: true },
  { pattern: /협찬.*받은.*리뷰/gi, weight: 100, description: '협찬받은 리뷰', critical: true },
  { pattern: /협찬.*받았습니다/gi, weight: 100, description: '협찬받았습니다', critical: true },
  { pattern: /제공.*받았습니다/gi, weight: 100, description: '제공받았습니다', critical: true },
  { pattern: /협찬.*받아.*써/gi, weight: 100, description: '협찬받아 써', critical: true },
  { pattern: /협찬.*받아.*올/gi, weight: 100, description: '협찬받아 올', critical: true },
  { pattern: /협찬.*받아.*솔직/gi, weight: 100, description: '협찬받아 솔직', critical: true },
  
  // 제품/서비스 제공 관련
  { pattern: /제품.*협찬.*받아/gi, weight: 100, description: '제품 협찬받아', critical: true },
  { pattern: /서비스.*협찬.*받아/gi, weight: 100, description: '서비스 협찬받아', critical: true },
  { pattern: /브랜드.*협찬.*받아/gi, weight: 100, description: '브랜드 협찬받아', critical: true },
  { pattern: /업체.*제공.*받아/gi, weight: 100, description: '업체 제공받아', critical: true },
  { pattern: /무료.*제공.*받아/gi, weight: 100, description: '무료 제공받아', critical: true },
  { pattern: /무료.*체험.*받아/gi, weight: 100, description: '무료 체험받아', critical: true },
  
  // 체험단/서포터즈 관련
  { pattern: /체험단.*선정/gi, weight: 100, description: '체험단 선정', critical: true },
  { pattern: /서포터즈.*선정/gi, weight: 100, description: '서포터즈 선정', critical: true },
  { pattern: /리뷰어.*선정/gi, weight: 100, description: '리뷰어 선정', critical: true },
  { pattern: /체험단.*활동/gi, weight: 100, description: '체험단 활동', critical: true },
  { pattern: /체험단으로.*받아/gi, weight: 100, description: '체험단으로 받아', critical: true },
  
  // 영어 패턴
  { pattern: /sponsored.*by/gi, weight: 100, description: 'Sponsored by', critical: true },
  { pattern: /provided.*by/gi, weight: 100, description: 'Provided by', critical: true },
  { pattern: /gifted.*by/gi, weight: 100, description: 'Gifted by', critical: true },
  { pattern: /complimentary.*from/gi, weight: 100, description: 'Complimentary from', critical: true },
  
  // 강력한 패턴 (30점)
  { pattern: /무료.*제공/gi, weight: 30, description: '무료 제공' },
  { pattern: /무료.*체험/gi, weight: 30, description: '무료 체험' },
  { pattern: /협찬.*받았/gi, weight: 30, description: '협찬 받음' },
  { pattern: /제공.*받은/gi, weight: 30, description: '제공 받음' },
  { pattern: /체험.*기회.*제공/gi, weight: 30, description: '체험 기회 제공' },
  { pattern: /무료.*증정/gi, weight: 30, description: '무료 증정' },
  
  // 중간 강도 패턴 (20점)
  { pattern: /체험.*기회/gi, weight: 20, description: '체험 기회' },
  { pattern: /브랜드.*협찬/gi, weight: 20, description: '브랜드 협찬' },
  { pattern: /업체.*제공/gi, weight: 20, description: '업체 제공' },
  { pattern: /이벤트.*당첨/gi, weight: 20, description: '이벤트 당첨' },
  { pattern: /선물.*받았/gi, weight: 20, description: '선물 받음' }
];

/**
 * Google Cloud Vision API를 사용하여 이미지에서 텍스트 추출
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<Object>} OCR 결과
 */
export async function extractTextFromImage(imageUrl) {
  if (!visionClient) {
    throw new Error('Google Cloud Vision API 클라이언트가 초기화되지 않았습니다.');
  }

  try {
    logger.info(`🔍 OCR 텍스트 추출 시작: ${imageUrl.substring(0, 60)}...`);

    // 이미지에서 텍스트 추출
    const [result] = await visionClient.textDetection({
      image: { source: { imageUri: imageUrl } }
    });

    const detections = result.textAnnotations;
    
    if (!detections || detections.length === 0) {
      logger.info('📝 추출된 텍스트 없음');
      return {
        success: true,
        fullText: '',
        textBlocks: [],
        confidence: 0
      };
    }

    // 전체 텍스트 (첫 번째 요소)
    const fullText = detections[0].description || '';
    
    // 개별 텍스트 블록들 (나머지 요소들)
    const textBlocks = detections.slice(1).map((text, index) => ({
      text: text.description,
      confidence: text.score || 0,
      bounds: text.boundingPoly,
      index: index
    }));

    logger.info(`📝 OCR 텍스트 추출 완료:`);
    logger.info(`- 전체 텍스트 길이: ${fullText.length}자`);
    logger.info(`- 텍스트 블록 수: ${textBlocks.length}개`);
    logger.info(`- 추출된 텍스트 미리보기: "${fullText.substring(0, 100)}..."`);

    // 개발 단계 로그: 각 텍스트 블록 상세 정보
    if (textBlocks.length > 0) {
      logger.info(`📋 추출된 텍스트 블록 상세:`);
      textBlocks.slice(0, 10).forEach((block, index) => { // 처음 10개만 로그
        logger.info(`  ${index + 1}. "${block.text}" (신뢰도: ${(block.confidence * 100).toFixed(1)}%)`);
      });
      
      if (textBlocks.length > 10) {
        logger.info(`  ... 외 ${textBlocks.length - 10}개 텍스트 블록`);
      }
    }

    return {
      success: true,
      fullText,
      textBlocks,
      confidence: detections[0].score || 0,
      imageUrl: imageUrl.substring(0, 100) + '...' // 디버깅용
    };

  } catch (error) {
    logger.error(`❌ OCR 텍스트 추출 실패: ${error.message}`);
    return {
      success: false,
      fullText: '',
      textBlocks: [],
      confidence: 0,
      error: error.message
    };
  }
}

/**
 * 추출된 텍스트에서 광고 키워드 분석
 * @param {string} text - 분석할 텍스트
 * @returns {Object} 광고 분석 결과
 */
export function analyzeTextForAdKeywords(text) {
  if (!text || text.trim().length === 0) {
    return {
      isAd: false,
      confidence: 0,
      detectedKeywords: [],
      patterns: [],
      score: 0,
      reason: '분석할 텍스트가 없음'
    };
  }

  logger.info(`🔍 텍스트 광고 키워드 분석 시작 (${text.length}자)`);

  const detectedKeywords = [];
  const matchedPatterns = [];
  let totalScore = 0;

  // 명시적 광고 키워드 검색 (critical level - 즉시 광고 판단)
  AD_KEYWORDS.critical.forEach(keyword => {
    const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    if (matches) {
      detectedKeywords.push({
        keyword,
        count: matches.length,
        weight: KEYWORD_WEIGHTS.critical,
        score: matches.length * KEYWORD_WEIGHTS.critical,
        type: 'critical'
      });
      totalScore += matches.length * KEYWORD_WEIGHTS.critical;
      logger.info(`  ✓ 명시적 광고 키워드 발견: "${keyword}" (${matches.length}회) +${matches.length * KEYWORD_WEIGHTS.critical}점`);
    }
  });

  // 강한 광고 신호 키워드 검색
  AD_KEYWORDS.strong.forEach(keyword => {
    const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    if (matches) {
      detectedKeywords.push({
        keyword,
        count: matches.length,
        weight: KEYWORD_WEIGHTS.strong,
        score: matches.length * KEYWORD_WEIGHTS.strong,
        type: 'strong'
      });
      totalScore += matches.length * KEYWORD_WEIGHTS.strong;
      logger.info(`  ✓ 강한 광고 신호 발견: "${keyword}" (${matches.length}회) +${matches.length * KEYWORD_WEIGHTS.strong}점`);
    }
  });

  // 약한 광고 신호 키워드 검색 (과도하지 않게)
  AD_KEYWORDS.weak.forEach(keyword => {
    const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    if (matches) {
      detectedKeywords.push({
        keyword,
        count: matches.length,
        weight: KEYWORD_WEIGHTS.weak,
        score: matches.length * KEYWORD_WEIGHTS.weak,
        type: 'weak'
      });
      totalScore += matches.length * KEYWORD_WEIGHTS.weak;
      logger.info(`  ✓ 약한 광고 신호 발견: "${keyword}" (${matches.length}회) +${matches.length * KEYWORD_WEIGHTS.weak}점`);
    }
  });

  // 광고성 패턴 검색
  AD_PATTERNS.forEach(({ pattern, weight, description }) => {
    const matches = text.match(pattern);
    if (matches) {
      matchedPatterns.push({
        pattern: pattern.toString(),
        description,
        count: matches.length,
        weight,
        score: matches.length * weight
      });
      totalScore += matches.length * weight;
      logger.info(`  ✓ 광고 패턴 발견: ${description} (${matches.length}회) +${matches.length * weight}점`);
    }
  });

  // Critical 레벨 키워드가 발견되면 점수와 관계없이 무조건 광고로 판단
  const hasCriticalKeywords = detectedKeywords.some(k => k.type === 'critical');
  const criticalPatterns = matchedPatterns.filter(p => p.weight >= 100);
  
  // Critical 키워드나 패턴이 있으면 무조건 광고 (점수 임계값 무시)
  if (hasCriticalKeywords || criticalPatterns.length > 0) {
    const isAd = true;
    const confidence = 100; // 명시적 광고 표시는 100% 확신
    
    logger.info(`🚨 명시적 광고 표시 발견 - 점수와 관계없이 무조건 광고로 분류!`);
    logger.info(`- Critical 키워드: ${hasCriticalKeywords ? detectedKeywords.filter(k => k.type === 'critical').map(k => k.keyword).join(', ') : '없음'}`);
    logger.info(`- Critical 패턴: ${criticalPatterns.length > 0 ? criticalPatterns.map(p => p.description).join(', ') : '없음'}`);
    logger.info(`- 총 점수: ${totalScore}점 (임계값 무시)`);
    
    return {
      isAd,
      confidence,
      detectedKeywords: detectedKeywords.map(k => k.keyword),
      keywordDetails: detectedKeywords,
      patterns: matchedPatterns,
      score: totalScore,
      reason: `명시적 광고 표시 발견 - 무조건 광고로 분류 (점수: ${totalScore}점, 임계값 무시)`
    };
  }

  // 명시적 광고 표시가 없는 경우에만 점수 기반 판단
  const confidence = Math.min(100, totalScore);
  const threshold = 30; // 일반 임계값
  const isAd = confidence >= threshold;

  const result = {
    isAd,
    confidence,
    detectedKeywords: detectedKeywords.map(k => k.keyword),
    keywordDetails: detectedKeywords,
    patterns: matchedPatterns,
    score: totalScore,
    reason: generateAnalysisReason(detectedKeywords, matchedPatterns, totalScore)
  };

  logger.info(`📊 텍스트 광고 분석 결과:`);
  logger.info(`- 광고 여부: ${isAd ? '광고' : '일반'}`);
  logger.info(`- 신뢰도: ${confidence}%`);
  logger.info(`- 총 점수: ${totalScore}점`);
  logger.info(`- 발견된 키워드: ${detectedKeywords.length}개`);
  logger.info(`- 매칭된 패턴: ${matchedPatterns.length}개`);

  return result;
}

/**
 * 분석 결과에 대한 이유 생성
 */
function generateAnalysisReason(keywords, patterns, score) {
  const reasons = [];

  if (keywords.some(k => k.type === 'critical')) {
    reasons.push('명시적 광고 표시 발견');
  }
  if (keywords.some(k => k.type === 'strong')) {
    reasons.push('강한 광고 신호 감지');
  }
  if (patterns.some(p => p.weight >= 100)) {
    reasons.push('Critical 광고 패턴 감지');
  }
  if (patterns.some(p => p.weight < 100 && p.weight >= 20)) {
    reasons.push('광고성 문구 패턴 감지');
  }
  if (keywords.some(k => k.type === 'weak') && keywords.length === keywords.filter(k => k.type === 'weak').length) {
    reasons.push('약한 광고 신호만 감지');
  }

  if (reasons.length === 0) {
    return '광고 요소가 발견되지 않음';
  }

  return `${reasons.join(', ')} (총 ${score}점)`;
}

/**
 * Google Cloud Vision API를 사용하여 종합적인 이미지 광고 분석
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<Object>} 종합 분석 결과
 */
export async function analyzeImageForAdWithGoogleVision(imageUrl) {
  if (!visionClient) {
    throw new Error('Google Cloud Vision API 클라이언트가 초기화되지 않았습니다.');
  }

  try {
    logger.info(`🎯 Google Vision 종합 이미지 분석 시작: ${imageUrl.substring(0, 60)}...`);

    // 병렬로 여러 Vision API 기능 실행
    const [
      textResult,
      labelResult, 
      logoResult,
      webResult
    ] = await Promise.all([
      // 1. 텍스트 감지
      visionClient.textDetection({ image: { source: { imageUri: imageUrl } } }),
      // 2. 라벨 감지 (객체/개념 인식)
      visionClient.labelDetection({ image: { source: { imageUri: imageUrl } } }),
      // 3. 로고 감지 (브랜드 로고)
      visionClient.logoDetection({ image: { source: { imageUri: imageUrl } } }),
      // 4. 웹 엔터티 감지 (상품/브랜드 정보)
      visionClient.webDetection({ image: { source: { imageUri: imageUrl } } })
    ]);

    // 각 분석 결과 정리
    const analysisResults = {
      text: processTextDetection(textResult[0]),
      labels: processLabelDetection(labelResult[0]),
      logos: processLogoDetection(logoResult[0]),
      web: processWebDetection(webResult[0])
    };

    // 종합 광고 점수 계산
    const adAnalysis = calculateAdScore(analysisResults);

    const result = {
      success: true,
      isAd: adAnalysis.isAd,
      confidence: adAnalysis.confidence,
      detectedKeywords: adAnalysis.detectedKeywords,
      reason: adAnalysis.reason,
      analysisDetails: {
        text: analysisResults.text,
        labels: analysisResults.labels,
        logos: analysisResults.logos,
        web: analysisResults.web,
        scoring: adAnalysis.scoring
      }
    };

    logger.info(`✅ Google Vision 종합 분석 완료:`);
    logger.info(`- 이미지 URL: ${imageUrl.substring(0, 100)}${imageUrl.length > 100 ? '...' : ''}`);
    logger.info(`- 감지된 텍스트: "${analysisResults.text.fullText?.substring(0, 80) || '없음'}${analysisResults.text.fullText?.length > 80 ? '...' : ''}"`);
    logger.info(`- 광고 키워드: ${analysisResults.text.adKeywords?.length || 0}개 [${analysisResults.text.adKeywords?.slice(0, 3).join(', ') || '없음'}]`);
    logger.info(`- 감지된 라벨: ${analysisResults.labels.relevant?.length || 0}개 [${analysisResults.labels.relevant?.slice(0, 3).map(l => l.description).join(', ') || '없음'}]`);
    logger.info(`- 감지된 로고: ${analysisResults.logos.detected?.length || 0}개 [${analysisResults.logos.detected?.slice(0, 3).map(l => l.description).join(', ') || '없음'}]`);
    logger.info(`- 웹 엔터티: ${analysisResults.web.entities?.length || 0}개 [${analysisResults.web.entities?.slice(0, 3).map(e => e.description).join(', ') || '없음'}]`);
    logger.info(`- 최종 판정: ${result.isAd ? '🔴 광고' : '🟢 일반'} (신뢰도: ${result.confidence}%)`);
    logger.info(`- 판정 근거: ${result.reason}`);

    return result;

  } catch (error) {
    logger.error(`❌ Google Vision 분석 실패: ${error.message}`);
    return {
      success: false,
      isAd: false,
      confidence: 0,
      error: error.message,
      reason: '분석 중 오류 발생'
    };
  }
}

/**
 * 텍스트 감지 결과 처리
 */
function processTextDetection(result) {
  const detections = result.textAnnotations;
  
  if (!detections || detections.length === 0) {
    return {
      fullText: '',
      textBlocks: [],
      adKeywords: [],
      adScore: 0
    };
  }

  const fullText = detections[0].description || '';
  const textBlocks = detections.slice(1).map(text => ({
    text: text.description,
    confidence: text.score || 0,
    bounds: text.boundingPoly
  }));

  // 텍스트에서 광고 키워드 분석
  const adKeywordAnalysis = analyzeTextForAdKeywords(fullText);

  return {
    fullText,
    textBlocks,
    adKeywords: adKeywordAnalysis.detectedKeywords,
    adScore: adKeywordAnalysis.score,
    adConfidence: adKeywordAnalysis.confidence
  };
}

/**
 * 라벨 감지 결과 처리 (광고성 라벨 분석)
 */
function processLabelDetection(result) {
  const labels = result.labelAnnotations || [];
  
  // 광고/상업적 라벨들
  const commercialLabels = [
    'advertisement', 'advertising', 'brand', 'logo', 'product', 'retail',
    'shopping', 'store', 'commercial', 'marketing', 'promotion', 'sale',
    'package', 'packaging', 'cosmetics', 'beauty product', 'food packaging',
    'bottle', 'container', 'box', 'bag', 'label'
  ];

  // 일반적인 일상 라벨들
  const lifestyleLabels = [
    'person', 'human face', 'smile', 'selfie', 'portrait', 'clothing',
    'food', 'meal', 'restaurant', 'home', 'room', 'furniture', 'nature',
    'outdoor', 'travel', 'family', 'friend'
  ];

  const relevant = labels.filter(label => label.score > 0.6);
  const commercial = relevant.filter(label => 
    commercialLabels.some(cl => label.description.toLowerCase().includes(cl))
  );
  const lifestyle = relevant.filter(label =>
    lifestyleLabels.some(ll => label.description.toLowerCase().includes(ll))
  );

  // 상업적 라벨 점수 계산
  const commercialScore = commercial.reduce((sum, label) => sum + (label.score * 10), 0);
  const lifestyleScore = lifestyle.reduce((sum, label) => sum + (label.score * 5), 0);

  return {
    all: labels,
    relevant,
    commercial,
    lifestyle,
    scores: {
      commercial: commercialScore,
      lifestyle: lifestyleScore,
      ratio: commercialScore / Math.max(lifestyleScore, 1)
    }
  };
}

/**
 * 로고 감지 결과 처리
 */
function processLogoDetection(result) {
  const logos = result.logoAnnotations || [];
  
  // 감지된 로고가 있으면 강한 광고 신호
  const logoScore = logos.reduce((sum, logo) => sum + (logo.score * 20), 0);

  return {
    detected: logos,
    count: logos.length,
    score: logoScore,
    hasLogo: logos.length > 0
  };
}

/**
 * 웹 엔터티 감지 결과 처리
 */
function processWebDetection(result) {
  const webDetection = result.webDetection || {};
  const entities = webDetection.webEntities || [];
  const pages = webDetection.pagesWithMatchingImages || [];

  // 상품/브랜드 관련 엔터티 필터링
  const productEntities = entities.filter(entity => 
    entity.description && entity.score > 0.5
  );

  // 상업적 웹사이트 도메인 체크
  const commercialDomains = ['amazon', 'ebay', 'shopping', 'store', 'mall', 'brand'];
  const commercialPages = pages.filter(page =>
    commercialDomains.some(domain => page.url?.includes(domain))
  );

  return {
    entities: productEntities,
    pages: commercialPages,
    score: productEntities.length * 5 + commercialPages.length * 10
  };
}

/**
 * 종합 광고 점수 계산
 */
function calculateAdScore(analysisResults) {
  const { text, labels, logos, web } = analysisResults;
  
  // 각 카테고리별 점수
  const scores = {
    text: text.adScore || 0,           // 텍스트 광고 키워드 (최대 100점)
    logos: logos.score || 0,           // 로고 감지 (최대 100점)
    labels: labels.scores.commercial || 0, // 상업적 라벨 (최대 50점)
    web: web.score || 0                // 웹 엔터티 (최대 50점)
  };

  // 가중치 적용
  const weights = {
    text: 1.0,    // 텍스트는 가장 확실한 신호
    logos: 0.8,   // 로고도 강한 신호
    labels: 0.6,  // 라벨은 보조적
    web: 0.4      // 웹 엔터티는 참고용
  };

  const weightedScore = 
    (scores.text * weights.text) +
    (scores.logos * weights.logos) +
    (scores.labels * weights.labels) +
    (scores.web * weights.web);

  const confidence = Math.min(100, Math.round(weightedScore));
  const isAd = confidence >= 35;

  // 발견된 키워드 수집
  const detectedKeywords = [
    ...text.adKeywords,
    ...logos.detected.map(logo => logo.description),
    ...labels.commercial.map(label => label.description)
  ];

  // 판단 근거 생성
  const reason = generateComprehensiveReason(scores, analysisResults, confidence);

  return {
    isAd,
    confidence,
    detectedKeywords,
    reason,
    scoring: {
      individual: scores,
      weighted: {
        text: scores.text * weights.text,
        logos: scores.logos * weights.logos,
        labels: scores.labels * weights.labels,
        web: scores.web * weights.web
      },
      total: weightedScore
    }
  };
}

/**
 * 종합적인 판단 근거 생성
 */
function generateComprehensiveReason(scores, analysisResults, confidence) {
  const reasons = [];
  
  if (scores.text >= 25) {
    reasons.push(`텍스트에서 광고 키워드 발견 (${scores.text}점)`);
  }
  
  if (scores.logos > 0) {
    const logoCount = analysisResults.logos.detected.length;
    reasons.push(`브랜드 로고 ${logoCount}개 감지 (${scores.logos}점)`);
  }
  
  if (scores.labels >= 20) {
    const commercialCount = analysisResults.labels.commercial.length;
    reasons.push(`상업적 요소 ${commercialCount}개 감지 (${scores.labels}점)`);
  }
  
  if (scores.web >= 10) {
    reasons.push(`웹에서 상품/브랜드 정보 발견 (${scores.web}점)`);
  }

  if (reasons.length === 0) {
    return '명확한 광고 요소가 감지되지 않음';
  }

  return `${reasons.join(', ')} - 총 ${confidence}점`;
}

export default {
  extractTextFromImage,
  analyzeTextForAdKeywords,
  analyzeImageForAdWithGoogleVision
};
