// services/naverSearchMonitor.js
import { chromium } from 'playwright';
import { createLogger } from '../lib/logger.js';
import BrandingBlogPost from '../models/BrandingBlogPost.js';
import BrandingBlog from '../models/BrandingBlog.js';

const logger = createLogger('NaverSearchMonitor');

/**
 * 네이버에서 제목으로 검색하여 해당 글이 노출되는지 확인
 * @param {string} title - 검색할 제목
 * @param {string} targetUrl - 찾아야 할 URL
 * @param {string} targetAuthor - 찾아야 할 작성자명
 * @param {string} blogId - 브랜딩 블로그 ID
 * @returns {Promise<Object>} 검색 결과
 */
export async function searchNaverBlogPost(title, targetUrl, targetAuthor, blogId) {
  let browser = null;
  
  try {
    logger.info(`네이버 모바일 블로그 검색 시작: "${title}"`);
    logger.info(`타겟 URL: ${targetUrl}`);
    logger.info(`타겟 작성자: ${targetAuthor || 'N/A'}`);
    logger.info(`브랜딩 블로그 ID: ${blogId || 'N/A'}`);
    
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
      viewport: { width: 375, height: 812 }
    });
    
    const page = await context.newPage();
    
    // 네이버 모바일 블로그 검색 페이지로 이동
    const searchQuery = `"${title}"`;
    const searchUrl = `https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&sm=mtb_jum&query=${encodeURIComponent(searchQuery)}`;
    
    logger.info(`검색 URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle' });
    
    // 검색 결과 대기
    await page.waitForTimeout(3000);
    
    // 블로그 검색 결과 추출
    const searchResults = await page.evaluate((targetUrl, targetAuthor, blogId) => {
      const results = [];
      
      // 모바일 네이버 블로그 검색 결과 선택자
      const blogItems = document.querySelectorAll('.lst_type .bx, .api_subject_bx, .total_wrap .blog_lnk, .cm_content_wrap, .content_wrap');
      
      logger.info(`검색 결과 ${blogItems.length}개 발견`);
      
      for (let i = 0; i < Math.min(blogItems.length, 10); i++) {
        const item = blogItems[i];
        
        try {
          // 제목 추출 (다양한 선택자 시도)
          const titleElement = item.querySelector('.total_tit a, .api_txt_lines.total_tit a, .title_link, .sub_txt.sub_name a, .name a, .title a');
          
          // 작성자 추출 (다양한 선택자 시도)
          const authorElement = item.querySelector('.sub_txt .name, .name, .author, .blog_name, .source_txt, .sub_name');
          
          // URL 추출
          const linkElement = item.querySelector('a') || titleElement;
          
          if (titleElement && linkElement) {
            const extractedTitle = titleElement.textContent.trim();
            const extractedAuthor = authorElement ? authorElement.textContent.trim() : '';
            const url = linkElement.href;
            
            // URL에서 블로그 ID 추출하여 매칭 확인
            const urlBlogId = url.match(/blog\.naver\.com\/([^\/\?]+)/);
            const isBlogIdMatch = urlBlogId && urlBlogId[1] === blogId;
            
            // 작성자명 매칭 확인 (부분 매칭 허용)
            const isAuthorMatch = targetAuthor && extractedAuthor && 
              (extractedAuthor.includes(targetAuthor) || targetAuthor.includes(extractedAuthor));
            
            // URL 직접 매칭 확인
            const isUrlMatch = url.includes(targetUrl.replace('https://', '').replace('http://', ''));
            
            const isTargetPost = isBlogIdMatch || isAuthorMatch || isUrlMatch;
            
            results.push({
              rank: i + 1,
              title: extractedTitle,
              author: extractedAuthor,
              url,
              blogId: urlBlogId ? urlBlogId[1] : null,
              isTarget: isTargetPost,
              matchReason: isTargetPost ? 
                (isBlogIdMatch ? 'blog_id_match' : 
                 isAuthorMatch ? 'author_match' : 
                 isUrlMatch ? 'url_match' : 'unknown') : null
            });
            
            console.log(`검색 결과 ${i + 1}: "${extractedTitle}" by ${extractedAuthor} (블로그: ${urlBlogId ? urlBlogId[1] : 'N/A'}) - 매칭: ${isTargetPost}`);
          }
        } catch (error) {
          console.error(`검색 결과 ${i + 1} 파싱 오류:`, error.message);
        }
      }
      
      return results;
    }, targetUrl, targetAuthor, blogId);
    
    // 타겟 포스트가 검색 결과에 있는지 확인 (1-3위)
    const targetResult = searchResults.find(result => result.isTarget && result.rank <= 3);
    
    const searchResult = {
      query: searchQuery,
      searchUrl,
      timestamp: new Date(),
      totalResults: searchResults.length,
      results: searchResults.slice(0, 5), // 상위 5개만 저장
      found: !!targetResult,
      ranking: targetResult ? targetResult.rank : null,
      matchedBy: targetResult ? targetResult.matchReason : null,
      targetInfo: {
        title,
        author: targetAuthor,
        blogId,
        url: targetUrl
      }
    };
    
    if (targetResult) {
      logger.info(`✅ 검색 성공: "${title}" - ${targetResult.rank}위 (매칭: ${targetResult.matchReason})`);
      logger.info(`   작성자: ${targetResult.author} (예상: ${targetAuthor})`);
      logger.info(`   블로그: ${targetResult.blogId} (예상: ${blogId})`);
    } else {
      logger.warn(`❌ 검색 실패: "${title}" - 3위 내 미발견`);
      logger.warn(`   검색 조건: 작성자 "${targetAuthor}", 블로그 "${blogId}"`);
      if (searchResults.length > 0) {
        logger.warn(`   발견된 결과들:`);
        searchResults.slice(0, 3).forEach(result => {
          logger.warn(`     ${result.rank}위: "${result.title}" by ${result.author} (${result.blogId})`);
        });
      }
    }
    
    return searchResult;
    
  } catch (error) {
    logger.error(`네이버 검색 오류: ${error.message}`);
    return {
      query: `"${title}"`,
      timestamp: new Date(),
      error: error.message,
      found: false,
      ranking: null,
      targetInfo: {
        title,
        author: targetAuthor,
        blogId,
        url: targetUrl
      }
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 브랜딩 블로그 포스트 검색 실행
 * @param {Object} brandingPost - 브랜딩 포스트 객체
 * @returns {Promise<Object>} 검색 결과
 */
export async function executeBrandingPostSearch(brandingPost) {
  try {
    logger.info(`브랜딩 포스트 검색 실행: ${brandingPost.id} - "${brandingPost.title}"`);
    logger.info(`작성자: ${brandingPost.author}, 블로그: ${brandingPost.brandingBlog?.blog_id}`);
    
    // 브랜딩 블로그 정보 가져오기
    const brandingBlog = brandingPost.brandingBlog;
    if (!brandingBlog) {
      throw new Error('브랜딩 블로그 정보를 찾을 수 없습니다.');
    }
    
    const searchResult = await searchNaverBlogPost(
      brandingPost.title, 
      brandingPost.post_url,
      brandingPost.author,
      brandingBlog.blog_id
    );
    
    // 검색 시도 횟수 증가
    const newAttempts = brandingPost.search_attempts + 1;
    
    // 검색 결과 저장
    const searchResults = brandingPost.search_results || {};
    searchResults[`attempt_${newAttempts}`] = searchResult;
    
    // 상태 업데이트
    let newStatus = brandingPost.search_check_status;
    let ranking = brandingPost.naver_ranking;
    
    if (searchResult.found) {
      newStatus = 'found';
      ranking = searchResult.ranking;
      logger.info(`🎉 브랜딩 포스트 노출 확인: ${ranking}위 (매칭 방식: ${searchResult.matchedBy})`);
    } else if (newAttempts >= 3) {
      newStatus = 'missed';
      logger.warn(`📢 브랜딩 포스트 노출 누락: 3회 검색 후 미발견`);
      logger.warn(`   제목: "${brandingPost.title}"`);
      logger.warn(`   작성자: ${brandingPost.author}`);
      logger.warn(`   블로그: ${brandingBlog.blog_id}`);
      logger.warn(`   URL: ${brandingPost.post_url}`);
    }
    
    // DB 업데이트
    await brandingPost.update({
      search_attempts: newAttempts,
      search_check_status: newStatus,
      search_results: searchResults,
      naver_ranking: ranking
    });
    
    return {
      success: true,
      found: searchResult.found,
      ranking: searchResult.ranking,
      attempts: newAttempts,
      status: newStatus,
      matchedBy: searchResult.matchedBy
    };
    
  } catch (error) {
    logger.error(`브랜딩 포스트 검색 실행 실패: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 스케줄된 검색 배치 실행
 */
export async function runScheduledSearches() {
  try {
    logger.info('⏰ 스케줄된 브랜딩 포스트 검색 배치 시작');
    
    const { getPendingSearchPosts } = await import('./brandingBlogService.js');
    const pendingPosts = await getPendingSearchPosts();
    
    const allPosts = [
      ...pendingPosts.first.map(post => ({ ...post, searchType: '1차' })),
      ...pendingPosts.second.map(post => ({ ...post, searchType: '2차' })),
      ...pendingPosts.third.map(post => ({ ...post, searchType: '3차' }))
    ];
    
    if (allPosts.length === 0) {
      logger.info('검색 예정인 브랜딩 포스트가 없습니다.');
      return;
    }
    
    logger.info(`검색 예정 포스트: ${allPosts.length}개`);
    
    const results = {
      total: allPosts.length,
      success: 0,
      found: 0,
      missed: 0,
      errors: 0
    };
    
    // 순차적으로 검색 실행 (병렬 처리 시 네이버 차단 위험)
    for (const post of allPosts) {
      try {
        logger.info(`${post.searchType} 검색: "${post.title}"`);
        
        const searchResult = await executeBrandingPostSearch(post);
        
        if (searchResult.success) {
          results.success++;
          if (searchResult.found) {
            results.found++;
          } else if (searchResult.status === 'missed') {
            results.missed++;
          }
        } else {
          results.errors++;
        }
        
        // 검색 간 딜레이 (네이버 차단 방지)
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        logger.error(`포스트 검색 오류: ${error.message}`);
        results.errors++;
      }
    }
    
    logger.info(`✅ 브랜딩 포스트 검색 배치 완료:`);
    logger.info(`- 총 처리: ${results.total}개`);
    logger.info(`- 성공: ${results.success}개`);
    logger.info(`- 노출 확인: ${results.found}개`);
    logger.info(`- 노출 누락: ${results.missed}개`);
    logger.info(`- 오류: ${results.errors}개`);
    
    return results;
    
  } catch (error) {
    logger.error(`스케줄된 검색 배치 실패: ${error.message}`);
    throw error;
  }
}

/**
 * 브랜딩 포스트 검색 상태 조회
 * @param {string} placeId - 플레이스 ID
 * @returns {Promise<Array>} 검색 상태 목록
 */
export async function getBrandingPostSearchStatus(placeId) {
  try {
    const brandingBlog = await BrandingBlog.findOne({
      where: {
        place_id: placeId,
        is_active: true
      }
    });
    
    if (!brandingBlog) {
      return [];
    }
    
    const posts = await BrandingBlogPost.findAll({
      where: {
        branding_blog_id: brandingBlog.id
      },
      order: [['published_at', 'DESC']],
      limit: 20
    });
    
    return posts.map(post => ({
      id: post.id,
      title: post.title,
      url: post.post_url,
      publishedAt: post.published_at,
      status: post.search_check_status,
      attempts: post.search_attempts,
      ranking: post.naver_ranking,
      firstSearchAt: post.first_search_at,
      secondSearchAt: post.second_search_at,
      thirdSearchAt: post.third_search_at,
      searchResults: post.search_results
    }));
    
  } catch (error) {
    logger.error(`브랜딩 포스트 검색 상태 조회 실패: ${error.message}`);
    return [];
  }
}
