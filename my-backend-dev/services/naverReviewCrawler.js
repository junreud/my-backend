import { chromium } from 'playwright';
import Review from '../models/Review.js';
import { createLogger } from '../lib/logger.js';
import { detectAccuratePlatformType } from '../utils/platformDetector.js';

const logger = createLogger('NaverReviewCrawler');

/**
 * 네이버 리뷰 크롤러 서비스
 */
class NaverReviewCrawler {
  constructor() {
    this.browser = null;
    this.context = null;
  }

  /**
   * 브라우저 초기화
   */
  async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage'
        ]
      });
      
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
        viewport: { width: 375, height: 667 }
      });
    }
    return this.context;
  }

  /**
   * 브라우저 종료
   */
  async closeBrowser() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * place_id로부터 네이버 플레이스 URL 생성
   */
  generateNaverPlaceUrl(placeId) {
    return `https://m.place.naver.com/place/${placeId}/review/ugc`;
  }

  /**
   * 네이버 리뷰 크롤링 (블로그 + 방문자 리뷰)
   */
  async crawlReviews(placeId, options = {}) {
    const { sortType = 'recommend', maxPages = 3, progressCallback } = options;
    
    try {
      await this.initBrowser();
      
      const allReviews = [];
      
      // 블로그 리뷰 크롤링 (40% 진행률)
      if (progressCallback) {
        progressCallback(20, '블로그 리뷰 수집 중...', 'blog');
      }
      const blogReviews = await this.crawlBlogReviewsDirect(placeId, sortType, maxPages);
      allReviews.push(...blogReviews);

      // 방문자 리뷰 크롤링 (70% 진행률)
      if (progressCallback) {
        progressCallback(50, '방문자 리뷰 수집 중...', 'receipt');
      }
      const receiptReviews = await this.crawlReceiptReviewsDirect(placeId, sortType, maxPages);
      allReviews.push(...receiptReviews);
      
      if (progressCallback) {
        progressCallback(75, `${allReviews.length}개 리뷰 수집 완료`, 'processing');
      }
      
      logger.info(`크롤링 완료: ${allReviews.length}개 리뷰 수집`, { placeId });
      return allReviews;
      
    } catch (error) {
      logger.error('리뷰 크롤링 실패:', error);
      throw error;
    }
  }

  /**
   * 블로그 리뷰 직접 크롤링
   */
  async crawlBlogReviewsDirect(placeId, sortType, maxPages) {
    const reviews = [];
    
    try {
      const page = await this.context.newPage();
      
      // 블로그 리뷰 URL 생성
      const baseUrl = `https://m.place.naver.com/place/${placeId}/review/ugc?type=photoView`;
      const url = sortType === 'latest' ? `${baseUrl}&reviewSort=recent` : baseUrl;
      
      logger.info(`블로그 리뷰 크롤링 시작: ${url}`);
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('div[class*="review"], div[class*="item"], article', { timeout: 10000 }).catch(() => {
        logger.warn('리뷰 컨테이너 대기 실패, 페이지 구조 변경 가능성');
      });
      
      // 페이지에서 리뷰 추출
      const pageReviews = await this.extractBlogReviewsFromPage(page, placeId);
      reviews.push(...pageReviews);
      
      await page.close();
      
      logger.info(`블로그 리뷰 수집 완료: ${reviews.length}개`);
      
    } catch (error) {
      logger.error('블로그 리뷰 크롤링 실패:', error);
    }

    return reviews;
  }

  /**
   * 방문자 리뷰 직접 크롤링
   */
  async crawlReceiptReviewsDirect(placeId, sortType, maxPages) {
    const reviews = [];
    
    try {
      const page = await this.context.newPage();
      
      // 방문자 리뷰 URL 생성
      const baseUrl = `https://m.place.naver.com/place/${placeId}/review/visitor?type=photoView`;
      const url = sortType === 'latest' ? `${baseUrl}&reviewSort=recent` : baseUrl;
      
      logger.info(`방문자 리뷰 크롤링 시작: ${url}`);
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('div[class*="review"], div[class*="item"], article', { timeout: 10000 }).catch(() => {
        logger.warn('리뷰 컨테이너 대기 실패, 페이지 구조 변경 가능성');
      });
      
      // 페이지에서 리뷰 추출
      const pageReviews = await this.extractReceiptReviewsFromPage(page, placeId);
      reviews.push(...pageReviews);
      
      await page.close();
      
      logger.info(`방문자 리뷰 수집 완료: ${reviews.length}개`);
      
    } catch (error) {
      logger.error('방문자 리뷰 크롤링 실패:', error);
    }

    return reviews;
  }

  /**
   * 정렬 순서 변경
   */
  async changeSortOrder(page, sortType) {
    try {
      // 정렬 버튼 클릭 (추천순/최신순)
      const sortSelector = sortType === 'latest' ? 
        'button[data-sort="recent"]' : 
        'button[data-sort="recommend"]';
      
      await page.waitForSelector(sortSelector, { timeout: 5000 });
      await page.click(sortSelector);
      await page.waitForSelector('div[class*="review"]', { timeout: 5000 }).catch(() => {
        logger.warn('정렬 적용 후 컨테이너 대기 실패');
      });
      
    } catch (error) {
      logger.warn('정렬 순서 변경 실패, 기본 정렬 사용:', error.message);
    }
  }

  /**
   * 블로그 리뷰 크롤링
   */
  async crawlBlogReviews(page, placeId, maxPages) {
    const reviews = [];
    
    try {
      // 블로그 리뷰 탭으로 이동
      await page.click('a[href*="blog"]');
      await page.waitForSelector('div[class*="review"], article', { timeout: 10000 }).catch(() => {
        logger.warn('블로그 리뷰 컨테이너 로딩 대기 실패');
      });

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const pageReviews = await this.extractBlogReviewsFromPage(page, placeId);
        reviews.push(...pageReviews);

        // 다음 페이지로 이동
        const hasNextPage = await this.goToNextPage(page);
        if (!hasNextPage) break;
      }
      
    } catch (error) {
      logger.error('블로그 리뷰 크롤링 실패:', error);
    }

    return reviews;
  }

  /**
   * 방문자 리뷰 크롤링
   */
  async crawlReceiptReviews(page, placeId, maxPages) {
    const reviews = [];
    
    try {
      // 방문자 리뷰 탭으로 이동
      await page.click('a[href*="visitor"]');
      await page.waitForSelector('div[class*="review"], article', { timeout: 10000 }).catch(() => {
        logger.warn('방문자 리뷰 컨테이너 로딩 대기 실패');
      });

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const pageReviews = await this.extractReceiptReviewsFromPage(page, placeId);
        reviews.push(...pageReviews);

        // 다음 페이지로 이동
        const hasNextPage = await this.goToNextPage(page);
        if (!hasNextPage) break;
      }
      
    } catch (error) {
      logger.error('방문자 리뷰 크롤링 실패:', error);
    }

    return reviews;
  }

  /**
   * 페이지에서 블로그 리뷰 추출
   */
  async extractBlogReviewsFromPage(page, placeId) {
    return await page.evaluate((placeId) => {
      const reviews = [];
      
      // 플랫폼 타입 감지 함수 (브라우저 환경에서 실행)
      function detectPlatformTypeInBrowser(url) {
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
        
        return 'other';
      }
      
      function detectPlatformTypeAdvancedInBrowser(title, content, urlBasedType) {
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
          '공유', '정보교환', '게시글', '글쓴이'
        ];
        
        // 블로그 특징적 키워드
        const blogKeywords = [
          '포스팅', '블로그', '후기', '리뷰',
          '체험', '방문', '개인적', '솔직',
          '추천', '맛집', '일상', '블로거'
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
      
      // 블로그 리뷰 아이템 선택자 - 더 포괄적으로 수정
      const selectors = [
        '.EblIP',
        'li[class*="blog"]',
        'li[class*="review"]',
        '[data-pui-click-code="review"]',
        'li.EblIP',
        'li[role="listitem"]'
      ];
      
      let reviewItems = [];
      for (const selector of selectors) {
        const items = document.querySelectorAll(selector);
        if (items.length > 0) {
          reviewItems = items;
          console.log(`블로그 리뷰 선택자 성공: ${selector}, 발견된 아이템: ${items.length}개`);
          break;
        }
      }
      
      if (reviewItems.length === 0) {
        console.log('블로그 리뷰 아이템을 찾을 수 없습니다. 전체 페이지 구조 확인:');
        console.log(document.body.innerHTML.substring(0, 1000));
      }
      
      reviewItems.forEach((item, index) => {
        try {
          const review = {
            place_id: placeId,
            review_type: 'blog',
            title: '',
            content: '',
            author: '',
            review_date: null,
            naver_review_id: '',
            images: [],
            url: '',
            has_owner_reply: false, // 블로그 리뷰에서는 항상 false
            platform_type: 'other' // 기본값, 나중에 URL과 콘텐츠 기반으로 업데이트
          };

          // 제목 추출 - 더 포괄적인 선택자
          const titleSelectors = [
            '.pui__dGLDWy',
            '.blog-title',
            'h3',
            '[class*="title"]',
            '.title'
          ];
          
          for (const sel of titleSelectors) {
            const titleEl = item.querySelector(sel);
            if (titleEl && titleEl.textContent.trim()) {
              review.title = titleEl.textContent.trim();
              break;
            }
          }

          // 내용 추출 - 더 포괄적인 선택자
          const contentSelectors = [
            '.pui__vn15t2 span',
            '.pui__vn15t2',
            '.review-content',
            '.blog-content',
            '[class*="content"]',
            '.content'
          ];
          
          for (const sel of contentSelectors) {
            const contentEl = item.querySelector(sel);
            if (contentEl && contentEl.textContent.trim()) {
              review.content = contentEl.textContent.trim();
              break;
            }
          }

          // 작성자 추출 - 더 포괄적인 선택자
          const authorSelectors = [
            '.pui__NMi-Dp',
            '.XR_ao',
            '.author',
            '.blogger',
            '[class*="author"]',
            '[class*="nickname"]'
          ];
          
          for (const sel of authorSelectors) {
            const authorEl = item.querySelector(sel);
            if (authorEl && authorEl.textContent.trim()) {
              review.author = authorEl.textContent.trim();
              break;
            }
          }

          // URL 추출
          const linkEl = item.querySelector('a[href*="blog.naver.com"], a[href*="tistory"], a[href]');
          if (linkEl && linkEl.href) {
            review.url = linkEl.href;
          }

          // 날짜 추출
          const dateSelectors = [
            '.u5XwJ time',
            '.X9yBv time',
            'time',
            '.date',
            '[class*="date"]'
          ];
          
          for (const sel of dateSelectors) {
            const dateEl = item.querySelector(sel);
            if (dateEl && dateEl.textContent.trim()) {
              const dateText = dateEl.textContent.trim();
              const dateMatch = dateText.match(/(\d{2,4})\.(\d{1,2})\.(\d{1,2})/);
              if (dateMatch) {
                let year = parseInt(dateMatch[1]);
                if (year < 100) year += 2000;
                const month = parseInt(dateMatch[2]);
                const day = parseInt(dateMatch[3]);
                // 날짜만 저장하고 시간은 정오(12:00)로 고정하여 시간대 문제 방지
                review.review_date = new Date(year, month - 1, day, 12, 0, 0);
                break;
              }
            }
          }

          // 본문 이미지 추출 (실제 콘텐츠 영역만)
          const mainContainer = item.querySelector('.se-main-container');
          const filteredImages = [];
          
          if (mainContainer) {
            // 네이버 블로그 본문 콘텐츠 영역을 더 정확히 타겟팅
            const contentSelectors = [
              '.se-main-container .se-component-content img', // 네이버 스마트에디터 콘텐츠
              '.se-main-container .se-text img', // 텍스트 컴포넌트 내 이미지
              '.se-main-container .se-image img', // 이미지 컴포넌트
              '.se-main-container .se-video img', // 비디오 썸네일
              '.se-main-container p img', // 단락 내 이미지
              '.se-main-container div img' // 기타 div 내 이미지
            ];
            
            let allContentImages = [];
            
            // 각 셀렉터로 이미지 수집
            for (const selector of contentSelectors) {
              const images = mainContainer.querySelectorAll(selector);
              allContentImages.push(...Array.from(images));
            }
            
            // 중복 제거
            const uniqueImages = [...new Set(allContentImages)];
            console.log(`본문 콘텐츠 영역에서 발견된 이미지: ${uniqueImages.length}개`);
            
            uniqueImages.forEach((img, index) => {
              const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
              
              if (src) {
                // 부모 요소 체크 (프로필, 헤더 등 제외)
                const parentClasses = img.closest('*').className || '';
                const isInExcludedArea = [
                  'profile', 'header', 'author', 'blogger', 'user-info', 
                  'navigation', 'sidebar', 'footer', 'menu', 'widget',
                  'comment', 'reply', 'social', 'share', 'follow'
                ].some(excludeClass => parentClasses.toLowerCase().includes(excludeClass));
                
                if (isInExcludedArea) {
                  console.log(`영역 제외 [${index}]: ${src.substring(0, 50)}... - 부모 클래스: ${parentClasses}`);
                  return;
                }
                
                // 제외할 이미지 패턴 (더 강화 - 프로필 이미지 강력 차단)
                const excludePatterns = [
                  'profile', 'icon', 'logo', 'avatar', 'thumb', 'thumbnail',
                  'button', 'arrow', 'badge', 'symbol', 'emoji', 'emoticon',
                  'banner', 'header', 'footer', 'sidebar', 'menu', 'nav',
                  '.gif', '_gif', 'loading', 'spinner', 'indicator',
                  'ad_', 'ads_', 'advertisement', 'promotion',
                  'social', 'share', 'like', 'comment', 'follow',
                  'watermark', 'overlay', 'decoration', 'blogger', 'author',
                  // 네이버 블로그 프로필 관련 강화 (더 포괄적으로)
                  'blogpfthumb', 'profile_image', 'blogProfile', 'authorProfile',
                  'user_profile', 'blogger_thumb', 'profile_pic', 'member_profile',
                  'pfthumb', 'profilethumb', 'pf_', 'thumb_', '_thumb',
                  'type=f48_48', 'type=f80_80', 'type=f100_100', 'type=f120_120', // 네이버 프로필 썸네일 크기들
                  'phinf.naver.net/20', // 네이버 프로필 이미지 서버 패턴
                  'ssl.pstatic.net/static/cafe',
                  'blogfiles.naver.net/profile', // 네이버 블로그 프로필
                  'storep-phinf.pstatic.net', // 네이버 스토어 프로필
                  'blogpfthumb', 'cafe_profile', 'user_thumb',
                  // 작은 크기나 UI 요소들
                  '16x16', '24x24', '32x32', '48x48', '64x64', '80x80', '100x100',
                  'small', 'mini', 'tiny', 'micro'
                ];
                
                // 크기 체크 (본문 이미지는 보통 200px 이상, 프로필은 보통 150px 이하)
                const width = parseInt(img.width) || parseInt(img.getAttribute('width')) || 0;
                const height = parseInt(img.height) || parseInt(img.getAttribute('height')) || 0;
                
                // 프로필 이미지 크기 패턴 체크 (네이버는 보통 48x48, 80x80, 100x100 등 + 일반 프로필 크기)
                const isProfileSize = (width > 0 && height > 0 && 
                  ((width <= 150 && height <= 150 && Math.abs(width - height) <= 20) || // 정사각형에 가까운 작은 이미지
                   (width <= 100 || height <= 100))); // 한 변이라도 100px 이하
                
                // 패턴 체크
                const hasExcludePattern = excludePatterns.some(pattern => 
                  src.toLowerCase().includes(pattern)
                );
                
                // 본문 이미지 판단 조건 (프로필 이미지 강력 배제)
                const isContentImage = !hasExcludePattern && 
                  !isProfileSize && // 프로필 크기 이미지 제외
                  (width === 0 || width >= 150) && // 너비가 150px 이상이거나 지정되지 않음
                  (height === 0 || height >= 150) && // 높이가 150px 이상이거나 지정되지 않음
                  src.startsWith('http') && // 유효한 URL
                  !src.includes('data:image') && // base64 이미지 제외
                  (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp')) && // 실제 이미지 파일
                  (!src.includes('?type=') || src.includes('?type=w') || src.includes('?type=f&size=')); // 네이버 이미지 원본 또는 큰 사이즈만
                
                if (isContentImage && filteredImages.length < 3) { // 최대 3개까지 수집 (2-3번째 선택을 위해)
                  filteredImages.push(src);
                  console.log(`✅ 본문 이미지 추가 [${filteredImages.length}]: ${src.substring(0, 70)}... (${width}x${height})`);
                } else if (isContentImage) {
                  console.log(`⚠️ 본문 이미지 제한 초과로 제외 [${index}]: ${src.substring(0, 50)}...`);
                } else {
                  console.log(`❌ 본문 이미지 제외 [${index}]: ${src.substring(0, 50)}... (${width}x${height}) - 제외 이유: ${hasExcludePattern ? '패턴 매칭' : isProfileSize ? '프로필 크기' : '크기 또는 형식'}`);
                }
              }
            });
          } else {
            console.log('본문 컨테이너(.se-main-container)를 찾을 수 없음, 전체 영역에서 검색');
            // 폴백: 전체 아이템에서 본문 스타일 이미지 추출
            const imageEls = item.querySelectorAll('img');
            imageEls.forEach((img, index) => {
              const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
              if (src && src.startsWith('http') && filteredImages.length < 2) {
                // 간단한 필터링만 적용
                const hasBasicExclude = ['profile', 'icon', 'logo', 'avatar'].some(pattern => 
                  src.toLowerCase().includes(pattern)
                );
                if (!hasBasicExclude) {
                  filteredImages.push(src);
                  console.log(`폴백 이미지 추가 [${filteredImages.length}]: ${src.substring(0, 60)}...`);
                }
              }
            });
          }
          
          // 본문 이미지만 저장 (2-3번째 이미지만 선택하여 프로필 사진 배제)
          let finalImages = [];
          if (filteredImages.length >= 2) {
            // 2번째, 3번째 이미지 선택 (첫 번째는 프로필일 가능성이 높음)
            finalImages = filteredImages.slice(1, 3); // 인덱스 1, 2 (2번째, 3번째)
            console.log(`🎯 2-3번째 이미지만 선택: ${finalImages.length}개 (전체 ${filteredImages.length}개 중)`);
          } else if (filteredImages.length === 1) {
            // 이미지가 1개뿐이면 그것이 본문 이미지일 가능성이 높으므로 사용
            finalImages = filteredImages;
            console.log(`🎯 이미지가 1개뿐이므로 사용: ${finalImages.length}개`);
          }
          
          review.images = finalImages;
          console.log(`🎯 최종 본문 이미지 ${review.images.length}개 선택됨`);
          if (review.images.length > 0) {
            console.log('📸 선택된 본문 이미지들:');
            review.images.forEach((img, idx) => {
              console.log(`  ${idx + 1}. ${img.substring(0, 80)}...`);
            });
          } else {
            console.log('⚠️ 본문 이미지가 발견되지 않았습니다.');
          }

          // 평점 제거 (네이버 블로그 리뷰에는 별점이 없음)
          // review.rating = 5; // 제거

          // 블로그 URL에서 고유 번호 추출하여 ID 생성
          let uniqueId = null;
          if (review.url) {
            // 블로그 URL에서 숫자 조합 추출 (예: /BlogPost.naver?blogId=xxx&logNo=123456789)
            const urlMatch = review.url.match(/logNo=(\d+)|\/(\d+)$/);
            if (urlMatch) {
              const blogPostId = urlMatch[1] || urlMatch[2];
              uniqueId = `blog_${placeId}_${blogPostId}`;
            } else {
              // URL이 있지만 숫자를 찾을 수 없는 경우
              uniqueId = `blog_${placeId}_${btoa(review.url).slice(0, 20)}`;
            }
          }
          
          review.naver_review_id = uniqueId || `blog_${placeId}_${review.author}_${review.review_date?.getTime() || Date.now()}`;

          // 플랫폼 타입 판단
          const urlBasedType = detectPlatformTypeInBrowser(review.url);
          review.platform_type = detectPlatformTypeAdvancedInBrowser(review.title, review.content, urlBasedType);
          
          console.log(`리뷰 플랫폼 타입 판단: URL="${review.url}" → ${urlBasedType} → ${review.platform_type}`);

          if (review.title || review.content) {
            reviews.push(review);
            console.log(`블로그 리뷰 추출 성공 [${index}]: 플랫폼=${review.platform_type}, 제목="${review.title}", 내용="${review.content.substring(0, 50)}..."`);
          }
          
        } catch (error) {
          console.error(`블로그 리뷰 파싱 오류 [${index}]:`, error);
        }
      });
      
      console.log(`총 ${reviews.length}개의 블로그 리뷰 추출 완료`);
      return reviews;
    }, placeId);
  }

  /**
   * 페이지에서 방문자 리뷰 추출
   */
  async extractReceiptReviewsFromPage(page, placeId) {
    return await page.evaluate((placeId) => {
      const reviews = [];
      
      // 방문자 리뷰 아이템 선택자 - 더 포괄적으로 수정
      const selectors = [
        '.place_apply_pui.EjjAW',
        'li[class*="ugc"]',
        'li[class*="visitor"]',
        '.EjjAW',
        'li.place_apply_pui',
        'li[class*="review"]'
      ];
      
      let reviewItems = [];
      for (const selector of selectors) {
        const items = document.querySelectorAll(selector);
        if (items.length > 0) {
          reviewItems = items;
          console.log(`방문자 리뷰 선택자 성공: ${selector}, 발견된 아이템: ${items.length}개`);
          break;
        }
      }
      
      if (reviewItems.length === 0) {
        console.log('방문자 리뷰 아이템을 찾을 수 없습니다. 전체 페이지 구조 확인:');
        console.log(document.body.innerHTML.substring(0, 1000));
      }
      
      reviewItems.forEach((item, index) => {
        try {
          const review = {
            place_id: placeId,
            review_type: 'receipt',
            title: '',
            content: '',
            author: '',
            review_date: null,
            naver_review_id: '',
            images: [],
            url: '',
            has_owner_reply: false
          };

          // 내용 추출 - 더 포괄적인 선택자
          const contentSelectors = [
            '.pui__vn15t2 a',
            '.pui__vn15t2',
            '.ugc-review-text',
            '.review-content',
            '[class*="content"]',
            '.content'
          ];
          
          for (const sel of contentSelectors) {
            const contentEl = item.querySelector(sel);
            if (contentEl && contentEl.textContent.trim()) {
              review.content = contentEl.textContent.trim();
              break;
            }
          }

          // 작성자 추출 - 더 포괄적인 선택자
          const authorSelectors = [
            '.pui__NMi-Dp',
            '.reviewer-name',
            '.author',
            '.nickname',
            '[class*="author"]',
            '[class*="nickname"]'
          ];
          
          for (const sel of authorSelectors) {
            const authorEl = item.querySelector(sel);
            if (authorEl && authorEl.textContent.trim()) {
              review.author = authorEl.textContent.trim();
              break;
            }
          }

          // 날짜 추출
          const dateSelectors = [
            '.pui__gfuUIT time',
            '.visit-date',
            '.review-date',
            'time',
            '.date',
            '[class*="date"]'
          ];
          
          for (const sel of dateSelectors) {
            const dateEl = item.querySelector(sel);
            if (dateEl && dateEl.textContent.trim()) {
              const dateText = dateEl.textContent.trim();
              const dateMatch = dateText.match(/(\d{1,2})\.(\d{1,2})/);
              if (dateMatch) {
                const currentYear = new Date().getFullYear();
                const month = parseInt(dateMatch[1]);
                const day = parseInt(dateMatch[2]);
                // 날짜만 저장하고 시간은 정오(12:00)로 고정하여 시간대 문제 방지
                review.review_date = new Date(currentYear, month - 1, day, 12, 0, 0);
                break;
              }
            }
          }

          // 사업자 답변 여부 체크 및 내용 추출
          let hasOwnerReply = false;
          let ownerReplyContent = null;
          let ownerReplyDate = null;
          
          // 사업자 답변 선택자 - 제공해주신 HTML 구조 기반
          const ownerReplySelectors = [
            '.pui__GbW8H7.pui__BDGQvd', // 답변 전체 컨테이너
            '.pui__MzrP-X .pui__XE54q7', // 답변 작성자 (사업자명)
            '.pui__J0tczd', // 답변 내용 부분
            '[class*="reply"]',
            '[class*="owner"]'
          ];
          
          for (const sel of ownerReplySelectors) {
            const replyEl = item.querySelector(sel);
            if (replyEl) {
              const replyText = replyEl.textContent.trim();
              // 사업자명이 포함되거나 답변 특징적 문구가 있는지 확인
              if (replyText && (
                replyText.includes('점') || 
                replyText.includes('센터') || 
                replyText.includes('업체') ||
                replyText.includes('감사드립니다') ||
                replyText.includes('회원님') ||
                replyText.length > 20 // 긴 텍스트는 답변일 가능성이 높음
              )) {
                hasOwnerReply = true;
                ownerReplyContent = replyText;
                
                // 답변 날짜 추출 시도
                const replyDateEl = replyEl.closest('.pui__GbW8H7')?.querySelector('.pui__J2qJgP');
                if (replyDateEl) {
                  ownerReplyDate = replyDateEl.textContent.trim();
                }
                
                console.log(`사업자 답변 발견: ${replyText.substring(0, 50)}...`);
                break;
              }
            }
          }

          // 답변 정보를 review 객체에 저장
          review.has_owner_reply = hasOwnerReply;
          if (hasOwnerReply && ownerReplyContent) {
            review.reply = ownerReplyContent;
            review.reply_date = ownerReplyDate ? new Date(ownerReplyDate) : null;
            review.reply_generated_by_ai = false; // 네이버에서 크롤링한 답변은 AI가 아님
            review.reply_status = 'published'; // 이미 게시된 상태
          }

          // 카페 리뷰 본문 이미지 추출 (개선된 필터링)
          const filteredImages = [];
          
          // 카페 리뷰의 본문 이미지 영역 타겟팅
          const cafeContentSelectors = [
            '.pui__n-w9w5 img', // 카페 리뷰 콘텐츠 영역
            '.pui__bWw-yy img', // 리뷰 내용 영역
            '.review-content img', // 일반적인 리뷰 콘텐츠
            'p img', // 단락 내 이미지
            'div img' // 기타 div 내 이미지
          ];
          
          let allContentImages = [];
          
          // 각 셀렉터로 이미지 수집
          for (const selector of cafeContentSelectors) {
            const images = item.querySelectorAll(selector);
            allContentImages.push(...Array.from(images));
          }
          
          // 중복 제거
          const uniqueImages = [...new Set(allContentImages)];
          console.log(`카페 리뷰 콘텐츠 영역에서 발견된 이미지: ${uniqueImages.length}개`);
          
          uniqueImages.forEach((img, index) => {
            const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
            
            if (src && filteredImages.length < 2) { // 최대 2개만 수집
              // 제외할 이미지 패턴
              const excludePatterns = [
                'profile', 'icon', 'logo', 'avatar', 'thumb', 'thumbnail',
                'button', 'arrow', 'badge', 'symbol', 'emoji',
                'banner', 'header', 'footer', 'sidebar', 'menu', 'nav',
                'spinner', 'loading', 'indicator'
              ];
              
              // 크기 체크
              const width = parseInt(img.width) || parseInt(img.getAttribute('width')) || 0;
              const height = parseInt(img.height) || parseInt(img.getAttribute('height')) || 0;
              
              // 패턴 체크
              const hasExcludePattern = excludePatterns.some(pattern => 
                src.toLowerCase().includes(pattern)
              );
              
              // 카페 리뷰 본문 이미지 판단 조건
              const isContentImage = !hasExcludePattern && 
                (width === 0 || width >= 150) && // 너비가 150px 이상이거나 지정되지 않음
                (height === 0 || height >= 150) && // 높이가 150px 이상이거나 지정되지 않음
                src.startsWith('http') && // 유효한 URL
                !src.includes('data:image') && // base64 이미지 제외
                (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp')) && // 실제 이미지 파일
                (src.includes('pup-review') || src.includes('cafe')); // 카페 리뷰 이미지 특징
              
              if (isContentImage) {
                filteredImages.push(src);
                console.log(`✅ 카페 리뷰 이미지 추가 [${filteredImages.length}]: ${src.substring(0, 70)}... (${width}x${height})`);
              } else {
                console.log(`❌ 카페 리뷰 이미지 제외 [${index}]: ${src.substring(0, 50)}... (${width}x${height}) - 제외 이유: ${hasExcludePattern ? '패턴 매칭' : '크기 또는 형식'}`);
              }
            }
          });
          
          review.images = filteredImages;
          console.log(`🎯 카페 리뷰 최종 이미지 ${review.images.length}개 선택됨`);

          // 평점 제거 (네이버 방문자 리뷰에는 별점이 없음)
          // review.rating = 5; // 제거

          // 방문 횟수 정보나 인증 수단 정보로 제목 생성
          let visitCount = '';
          const visitInfos = item.querySelectorAll('.pui__gfuUIT');
          visitInfos.forEach(info => {
            const text = info.textContent.trim();
            if (text.includes('번째')) {
              review.title = `${text} 방문 리뷰`;
              // 방문 횟수 추출 (예: "3번째" -> "3")
              const countMatch = text.match(/(\d+)번째/);
              if (countMatch) {
                visitCount = countMatch[1];
              }
            } else if (text.includes('영수증')) {
              review.title = review.title || '영수증 인증 리뷰';
            }
          });

          // 회원 ID 추출 시도 (URL에서)
          let memberId = '';
          const memberLinks = item.querySelectorAll('a[href*="/my/"]');
          if (memberLinks.length > 0) {
            const memberUrl = memberLinks[0].href;
            const memberMatch = memberUrl.match(/\/my\/([a-zA-Z0-9]+)/);
            if (memberMatch) {
              memberId = memberMatch[1];
            }
          }

          // 고유 ID 생성: 회원ID + 등록일 + 방문횟수 조합
          const dateStr = review.review_date ? 
            review.review_date.toISOString().split('T')[0].replace(/-/g, '') : 
            '';
          
          review.naver_review_id = memberId ? 
            `receipt_${placeId}_${memberId}_${dateStr}_${visitCount}` :
            `receipt_${placeId}_${review.author}_${dateStr}_${visitCount || index}`;

          if (review.content) {
            reviews.push(review);
            console.log(`방문자 리뷰 추출 성공 [${index}]: 내용="${review.content.substring(0, 50)}..."`);
          }
          
        } catch (error) {
          console.error(`방문자 리뷰 파싱 오류 [${index}]:`, error);
        }
      });
      
      console.log(`총 ${reviews.length}개의 방문자 리뷰 추출 완료`);
      return reviews;
    }, placeId);
  }

  /**
   * 다음 페이지로 이동
   */
  async goToNextPage(page) {
    try {
      const nextButton = await page.locator('.pagination .next, .page-next, [aria-label="다음"]').first();
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForSelector('div[class*="review"], article', { timeout: 10000 }).catch(() => {
          logger.warn('다음 페이지 로딩 후 컨테이너 대기 실패');
        });
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 크롤링한 리뷰를 DB에 저장
   */
  async saveReviewsToDb(reviews) {
    const savedReviews = [];
    
    logger.info(`DB 저장 시작: ${reviews.length}개 리뷰 처리`);
    
    for (let i = 0; i < reviews.length; i++) {
      const reviewData = reviews[i];
      try {
        // 리뷰 데이터 검증 로그
        logger.info(`리뷰 데이터 검증 [${i+1}/${reviews.length}]:`, {
          naver_review_id: reviewData.naver_review_id,
          place_id: reviewData.place_id,
          review_type: reviewData.review_type,
          title: reviewData.title?.substring(0, 50),
          content: reviewData.content?.substring(0, 50),
          author: reviewData.author,
          url: reviewData.url?.substring(0, 50),
          images_count: reviewData.images?.length || 0
        });

        // 필수 필드 검증
        if (!reviewData.naver_review_id) {
          logger.error(`필수 필드 누락 - naver_review_id가 없습니다 [${i+1}]`);
          continue;
        }

        if (!reviewData.place_id) {
          logger.error(`필수 필드 누락 - place_id가 없습니다 [${i+1}]`);
          continue;
        }

        if (!reviewData.review_type) {
          logger.error(`필수 필드 누락 - review_type이 없습니다 [${i+1}]`);
          continue;
        }

        // 중복 체크
        const existingReview = await Review.findOne({
          where: { naver_review_id: reviewData.naver_review_id }
        });
        
        if (existingReview) {
          logger.info(`중복 리뷰 발견, 건너뜀 [${i+1}]: ${reviewData.naver_review_id}`);
          continue;
        }
        
        // 서버 측에서 정확한 플랫폼 타입 재분석
        if (reviewData.review_type === 'blog') {
          const accuratePlatformType = detectAccuratePlatformType(
            reviewData.title, 
            reviewData.content, 
            reviewData.author, 
            reviewData.url
          );
          reviewData.platform_type = accuratePlatformType;
          
          logger.info(`리뷰 플랫폼 타입 재분석: ${accuratePlatformType}`, {
            title: reviewData.title?.substring(0, 30),
            author: reviewData.author,
            url: reviewData.url?.substring(0, 50)
          });
        }
        
        const savedReview = await Review.create(reviewData);
        savedReviews.push(savedReview);
        logger.info(`리뷰 저장 성공 [${i+1}]: ${reviewData.naver_review_id}`);
        
        // 브랜딩 블로그 포스트 등록 (블로그 리뷰인 경우)
        if (reviewData.review_type === 'blog' && reviewData.url) {
          try {
            const { registerBrandingBlogPost } = await import('./brandingBlogService.js');
            const brandingPost = await registerBrandingBlogPost({
              placeId: reviewData.place_id,
              postUrl: reviewData.url,
              title: reviewData.title,
              content: reviewData.content,
              author: reviewData.author,
              publishedAt: reviewData.review_date || new Date()
            });
            
            if (brandingPost) {
              logger.info(`브랜딩 블로그 포스트 등록: "${reviewData.title}"`);
            }
          } catch (brandingError) {
            logger.warn(`브랜딩 블로그 포스트 등록 실패:`, brandingError.message);
          }
        }
        
      } catch (error) {
        logger.error(`리뷰 저장 실패 [${i+1}]:`, {
          error: error.message,
          naver_review_id: reviewData.naver_review_id,
          place_id: reviewData.place_id,
          review_type: reviewData.review_type
        });
        if (error.sql) {
          logger.error('SQL 에러:', error.sql);
        }
      }
    }
    
    logger.info(`DB 저장 완료: ${savedReviews.length}개 리뷰 저장 (전체 ${reviews.length}개 중)`);
    return savedReviews;
  }

  /**
   * 전체 크롤링 및 저장 프로세스
   */
  async crawlAndSaveReviews(placeId, options = {}) {
    const { progressCallback } = options;
    
    try {
      const reviews = await this.crawlReviews(placeId, options);
      
      // 데이터베이스 저장 진행률 업데이트
      if (progressCallback) {
        progressCallback(80, `${reviews.length}개 리뷰 데이터베이스 저장 중...`, 'saving');
      }
      
      const savedReviews = await this.saveReviewsToDb(reviews);
      
      // 크롤링 완료 시간 업데이트
      await this.updateCrawlTime(placeId, reviews);
      
      return {
        total: reviews.length,
        saved: savedReviews.length,
        reviews: savedReviews
      };
    } finally {
      await this.closeBrowser();
    }
  }

  /**
   * Place 테이블의 크롤링 시간 업데이트
   */
  async updateCrawlTime(placeId, reviews) {
    try {
      // 크롤링 완료 로그 (Place 테이블 업데이트 제거)
      const hasBlogReviews = reviews.some(r => r.review_type === 'blog');
      const hasReceiptReviews = reviews.some(r => r.review_type === 'receipt');
      
      const reviewTypes = [];
      if (hasBlogReviews) reviewTypes.push('블로그');
      if (hasReceiptReviews) reviewTypes.push('영수증');
      
      if (reviewTypes.length > 0) {
        logger.info(`${reviewTypes.join(', ')} 리뷰 크롤링 완료: ${placeId}`);
      }
    } catch (error) {
      logger.error('크롤링 시간 업데이트 실패:', error);
    }
  }
}

export default NaverReviewCrawler;
