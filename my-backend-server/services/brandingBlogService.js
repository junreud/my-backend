// services/brandingBlogService.js
import { createLogger } from '../lib/logger.js';
import BrandingBlog from '../models/BrandingBlog.js';
import BrandingBlogPost from '../models/BrandingBlogPost.js';
import { Op } from 'sequelize';

const logger = createLogger('BrandingBlogService');

/**
 * 네이버 플레이스에서 브랜딩 블로그 URL 추출
 * @param {string} placeId - 네이버 플레이스 ID
 * @returns {Promise<Array>} 브랜딩 블로그 URL 목록
 */
export async function extractBrandingBlogUrls(placeId) {
  try {
    logger.info(`브랜딩 블로그 URL 추출 시작: ${placeId}`);
    
    // 모바일 플레이스 페이지 크롤링
    const mobileUrl = `https://m.place.naver.com/place/${placeId}/home`;
    
    // 여기서 실제 크롤링 로직 구현 필요
    // 현재는 예시 구조만 제공
    const brandingBlogs = [];
    
    // TODO: 실제 크롤링 구현
    // const page = await browser.newPage();
    // await page.goto(mobileUrl);
    // const blogElements = await page.$$('.O8qbU.yIPfO');
    // 
    // for (const element of blogElements) {
    //   const blogLink = await element.$('a.place_bluelink.CHmqa');
    //   if (blogLink) {
    //     const href = await blogLink.getAttribute('href');
    //     if (href && href.includes('blog.naver.com')) {
    //       brandingBlogs.push({
    //         url: href,
    //         platform: 'naver_blog',
    //         blogId: extractBlogIdFromUrl(href)
    //       });
    //     }
    //   }
    // }
    
    logger.info(`브랜딩 블로그 ${brandingBlogs.length}개 발견`);
    return brandingBlogs;
    
  } catch (error) {
    logger.error(`브랜딩 블로그 URL 추출 실패: ${error.message}`);
    return [];
  }
}

/**
 * 블로그 URL에서 블로그 ID 추출
 * @param {string} blogUrl - 블로그 URL
 * @returns {string} 블로그 ID
 */
function extractBlogIdFromUrl(blogUrl) {
  const match = blogUrl.match(/blog\.naver\.com\/([^\/\?]+)/);
  return match ? match[1] : null;
}

/**
 * 브랜딩 블로그 등록/업데이트
 * @param {string} placeId - 플레이스 ID
 * @param {string} placeName - 업체명
 * @param {Array} blogUrls - 브랜딩 블로그 URL 목록
 */
export async function registerBrandingBlogs(placeId, placeName, blogUrls) {
  try {
    logger.info(`브랜딩 블로그 등록/업데이트: ${placeId} - ${blogUrls.length}개`);
    
    for (const blogInfo of blogUrls) {
      const blogId = extractBlogIdFromUrl(blogInfo.url);
      if (!blogId) continue;
      
      const [brandingBlog, created] = await BrandingBlog.findOrCreate({
        where: {
          place_id: placeId,
          blog_url: blogInfo.url
        },
        defaults: {
          place_name: placeName,
          blog_id: blogId,
          platform: blogInfo.platform || 'naver_blog',
          is_active: true
        }
      });
      
      if (created) {
        logger.info(`새 브랜딩 블로그 등록: ${blogInfo.url}`);
      } else {
        // 기존 블로그 정보 업데이트
        await brandingBlog.update({
          place_name: placeName,
          is_active: true
        });
        logger.info(`기존 브랜딩 블로그 업데이트: ${blogInfo.url}`);
      }
    }
    
  } catch (error) {
    logger.error(`브랜딩 블로그 등록 실패: ${error.message}`);
    throw error;
  }
}

/**
 * 브랜딩 블로그 포스트 등록
 * @param {Object} postData - 포스트 데이터
 */
export async function registerBrandingBlogPost(postData) {
  try {
    const {
      placeId,
      postUrl,
      title,
      content,
      author,
      publishedAt
    } = postData;
    
    // 해당 플레이스의 브랜딩 블로그 찾기
    const brandingBlog = await BrandingBlog.findOne({
      where: {
        place_id: placeId,
        is_active: true
      }
    });
    
    if (!brandingBlog) {
      logger.warn(`브랜딩 블로그를 찾을 수 없음: ${placeId}`);
      return null;
    }
    
    // 포스트 URL이 브랜딩 블로그의 것인지 확인
    if (!postUrl.includes(brandingBlog.blog_id)) {
      return null; // 브랜딩 블로그 포스트가 아님
    }
    
    const publishedTime = new Date(publishedAt);
    
    // 검색 스케줄 계산
    const firstSearchTime = new Date(publishedTime.getTime() + 3 * 60 * 60 * 1000); // 3시간 후
    const secondSearchTime = new Date(publishedTime.getTime() + 9 * 60 * 60 * 1000); // 9시간 후
    const thirdSearchTime = new Date(publishedTime.getTime() + 15 * 60 * 60 * 1000); // 15시간 후
    
    const [brandingPost, created] = await BrandingBlogPost.findOrCreate({
      where: {
        post_url: postUrl
      },
      defaults: {
        branding_blog_id: brandingBlog.id,
        title,
        content,
        author,
        published_at: publishedTime,
        is_branding_post: true,
        search_check_status: 'pending',
        first_search_at: firstSearchTime,
        second_search_at: secondSearchTime,
        third_search_at: thirdSearchTime,
        search_results: {}
      }
    });
    
    if (created) {
      logger.info(`브랜딩 블로그 포스트 등록: "${title}"`);
      logger.info(`검색 스케줄:`);
      logger.info(`- 1차: ${firstSearchTime.toLocaleString('ko-KR')}`);
      logger.info(`- 2차: ${secondSearchTime.toLocaleString('ko-KR')}`);
      logger.info(`- 3차: ${thirdSearchTime.toLocaleString('ko-KR')}`);
    }
    
    return brandingPost;
    
  } catch (error) {
    logger.error(`브랜딩 블로그 포스트 등록 실패: ${error.message}`);
    throw error;
  }
}

/**
 * 브랜딩 블로그 여부 확인
 * @param {Object} review - 리뷰 객체
 * @returns {Promise<boolean>} 브랜딩 블로그 여부
 */
export async function isBrandingBlogPost(review) {
  try {
    if (!review.url) return false;
    
  // URL에서 블로그 ID 추출하여 매칭 확인
  const blogId = extractBlogIdFromUrl(review.url);
  if (!blogId) return false;
  
  // 브랜딩 블로그 확인
  const brandingBlog = await BrandingBlog.findOne({
    where: {
      blog_id: blogId,
      is_active: true
    }
  });
  
  return !!brandingBlog;
    
  } catch (error) {
    logger.error(`브랜딩 블로그 확인 실패: ${error.message}`);
    return false;
  }
}

/**
 * 검색 예정인 브랜딩 포스트 조회
 * @returns {Promise<Array>} 검색 예정 포스트 목록
 */
export async function getPendingSearchPosts() {
  try {
    const now = new Date();
    
    // 1차 검색 예정 (3시간 후)
    const firstSearchPosts = await BrandingBlogPost.findAll({
      where: {
        search_check_status: 'pending',
        search_attempts: 0,
        first_search_at: {
          [Op.lte]: now
        }
      },
      include: [{
        model: BrandingBlog,
        as: 'brandingBlog'
      }]
    });
    
    // 2차 검색 예정 (9시간 후)
    const secondSearchPosts = await BrandingBlogPost.findAll({
      where: {
        search_check_status: 'pending',
        search_attempts: 1,
        second_search_at: {
          [Op.lte]: now
        }
      },
      include: [{
        model: BrandingBlog,
        as: 'brandingBlog'
      }]
    });
    
    // 3차 검색 예정 (15시간 후)
    const thirdSearchPosts = await BrandingBlogPost.findAll({
      where: {
        search_check_status: 'pending',
        search_attempts: 2,
        third_search_at: {
          [Op.lte]: now
        }
      },
      include: [{
        model: BrandingBlog,
        as: 'brandingBlog'
      }]
    });
    
    return {
      first: firstSearchPosts,
      second: secondSearchPosts,
      third: thirdSearchPosts
    };
    
  } catch (error) {
    logger.error(`검색 예정 포스트 조회 실패: ${error.message}`);
    return { first: [], second: [], third: [] };
  }
}

export {
  extractBlogIdFromUrl
};
