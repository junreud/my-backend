// utils/platformDetector.js
import { createLogger } from '../lib/logger.js';

const logger = createLogger('PlatformDetector');

/**
 * URL을 기반으로 플랫폼 타입을 판단
 * @param {string} url - 리뷰 URL
 * @returns {string} 플랫폼 타입 ('blog', 'cafe', 'other')
 */
export function detectPlatformType(url) {
  if (!url || typeof url !== 'string') {
    return 'other';
  }

  const urlLower = url.toLowerCase();

  // 네이버 블로그
  if (urlLower.includes('blog.naver.com') || urlLower.includes('m.blog.naver.com')) {
    return 'blog';
  }

  // 네이버 카페
  if (urlLower.includes('cafe.naver.com') || urlLower.includes('m.cafe.naver.com')) {
    return 'cafe';
  }

  // 기타 블로그 플랫폼
  if (urlLower.includes('tistory.com') || 
      urlLower.includes('wordpress.com') || 
      urlLower.includes('medium.com') ||
      urlLower.includes('velog.io') ||
      urlLower.includes('github.io')) {
    return 'blog';
  }

  // 기타 커뮤니티/카페 플랫폼
  if (urlLower.includes('daum.net/cafe') || 
      urlLower.includes('dcinside.com') ||
      urlLower.includes('clien.net') ||
      urlLower.includes('ppomppu.co.kr')) {
    return 'cafe';
  }

  // 판단할 수 없는 경우
  return 'other';
}

/**
 * 제목과 내용을 기반으로 플랫폼 타입을 추가 판단
 * @param {string} title - 리뷰 제목
 * @param {string} content - 리뷰 내용
 * @param {string} urlBasedType - URL 기반 판단 결과
 * @returns {string} 최종 플랫폼 타입
 */
export function detectPlatformTypeAdvanced(title, content, urlBasedType) {
  // URL 기반 판단이 확실한 경우 그대로 사용
  if (urlBasedType !== 'other') {
    return urlBasedType;
  }

  // 제목/내용 기반 추가 판단
  const text = `${title || ''} ${content || ''}`.toLowerCase();

  // 카페 특징적 키워드
  const cafeKeywords = [
    '카페', '동호회', '모임', '회원', '가입',
    '커뮤니티', '게시판', '댓글', '추천',
    '공유', '정보교환'
  ];

  // 블로그 특징적 키워드
  const blogKeywords = [
    '포스팅', '블로그', '후기', '리뷰',
    '체험', '방문', '개인적', '솔직',
    '추천', '맛집', '일상'
  ];

  let cafeScore = 0;
  let blogScore = 0;

  cafeKeywords.forEach(keyword => {
    if (text.includes(keyword)) cafeScore++;
  });

  blogKeywords.forEach(keyword => {
    if (text.includes(keyword)) blogScore++;
  });

  if (cafeScore > blogScore && cafeScore >= 2) {
    return 'cafe';
  }

  if (blogScore > cafeScore && blogScore >= 2) {
    return 'blog';
  }

  return 'other';
}

/**
 * 기존 리뷰들의 플랫폼 타입을 일괄 업데이트
 * @param {Array} reviews - 리뷰 배열
 * @returns {Promise<Object>} 업데이트 결과
 */
export async function updatePlatformTypes(reviews) {
  const results = {
    updated: 0,
    blog: 0,
    cafe: 0,
    other: 0
  };

  for (const review of reviews) {
    try {
      const urlBasedType = detectPlatformType(review.url);
      const finalType = detectPlatformTypeAdvanced(
        review.title, 
        review.content, 
        urlBasedType
      );

      if (review.platform_type !== finalType) {
        await review.update({ platform_type: finalType });
        results.updated++;
        results[finalType]++;
        
        logger.info(`리뷰 ${review.id} 플랫폼 타입 업데이트: ${finalType}`, {
          url: review.url?.substring(0, 50),
          title: review.title?.substring(0, 30)
        });
      }
    } catch (error) {
      logger.error(`리뷰 ${review.id} 플랫폼 타입 업데이트 실패:`, error.message);
    }
  }

  logger.info('플랫폼 타입 일괄 업데이트 완료:', results);
  return results;
}

/**
 * 네이버플레이스 블로그리뷰 섹션에서 더 정확한 플랫폼 타입 구분
 * @param {string} title - 리뷰 제목
 * @param {string} content - 리뷰 내용  
 * @param {string} author - 작성자명
 * @param {string} url - 리뷰 URL
 * @returns {string} 플랫폼 타입 ('blog', 'cafe', 'other')
 */
export function detectAccuratePlatformType(title, content, author, url) {
  // 1차: URL 기반 판단
  const urlBasedType = detectPlatformType(url);
  
  // URL로 확실히 구분되는 경우
  if (urlBasedType === 'blog' || urlBasedType === 'cafe') {
    return urlBasedType;
  }
  
  // 2차: 텍스트 분석 기반 고도화 판단
  const text = `${title || ''} ${content || ''} ${author || ''}`.toLowerCase();
  
  // 카페 강력 신호 키워드 (가중치 3)
  const strongCafeKeywords = [
    '카페', '동호회', '모임', '커뮤니티', '게시판',
    '회원', '가입', '닉네임', '프로필', '등급'
  ];
  
  // 카페 약한 신호 키워드 (가중치 1)
  const weakCafeKeywords = [
    '댓글', '추천', '공유', '정보교환', '게시글',
    '글쓴이', '작성자', '답글', '좋아요'
  ];
  
  // 블로그 강력 신호 키워드 (가중치 3)
  const strongBlogKeywords = [
    '블로그', '포스팅', '블로거', '개인', '일상',
    '솔직후기', '체험단', '협찬'
  ];
  
  // 블로그 약한 신호 키워드 (가중치 1)
  const weakBlogKeywords = [
    '후기', '리뷰', '체험', '방문', '맛집',
    '추천', '솔직', '개인적'
  ];
  
  let cafeScore = 0;
  let blogScore = 0;
  
  // 강력 신호 키워드 체크
  strongCafeKeywords.forEach(keyword => {
    if (text.includes(keyword)) cafeScore += 3;
  });
  
  strongBlogKeywords.forEach(keyword => {
    if (text.includes(keyword)) blogScore += 3;
  });
  
  // 약한 신호 키워드 체크
  weakCafeKeywords.forEach(keyword => {
    if (text.includes(keyword)) cafeScore += 1;
  });
  
  weakBlogKeywords.forEach(keyword => {
    if (text.includes(keyword)) blogScore += 1;
  });
  
  // 3차: 작성자명 패턴 분석
  if (author) {
    // 카페 닉네임 패턴
    if (author.includes('★') || author.includes('♡') || author.includes('♥') || 
        author.match(/\d{4,}/) || author.includes('님') || author.includes('맘')) {
      cafeScore += 2;
    }
    
    // 블로그 닉네임 패턴 (개인적 느낌)
    if (author.includes('블로거') || author.includes('리뷰어') || 
        author.match(/^[가-힣]{2,4}$/) || author.includes('_')) {
      blogScore += 2;
    }
  }
  
  // 4차: 제목 패턴 분석
  if (title) {
    // 카페글 제목 패턴
    if (title.includes('[') && title.includes(']') || 
        title.includes('문의') || title.includes('질문') ||
        title.includes('추천') || title.includes('정보')) {
      cafeScore += 2;
    }
    
    // 블로그 제목 패턴
    if (title.includes('다녀왔어요') || title.includes('후기') ||
        title.includes('솔직') || title.includes('체험') ||
        title.includes('맛집') || title.includes('리뷰')) {
      blogScore += 2;
    }
  }
  
  logger.info(`플랫폼 타입 분석 점수: 카페=${cafeScore}, 블로그=${blogScore}`, {
    title: title?.substring(0, 30),
    author,
    url: url?.substring(0, 50)
  });
  
  // 점수 기반 최종 판단
  if (cafeScore > blogScore && cafeScore >= 3) {
    return 'cafe';
  }
  
  if (blogScore > cafeScore && blogScore >= 3) {
    return 'blog';
  }
  
  // 기본값은 블로그 (네이버플레이스 블로그리뷰 섹션이므로)
  return 'blog';
}
