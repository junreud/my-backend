import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { createLogger } from '../lib/logger.js';
import { randomDelay } from '../config/crawler.js';
import { CustomerInfo } from '../models/index.js';
import HttpsProxyAgent from 'https-proxy-agent';
import { loadMobileUAandCookies, PROXY_SERVER } from '../config/crawler.js';

const logger = createLogger('NaverPlaceService');

/**
 * 회사명에서 한글과 영어, 숫자, 공백만 남기고 제거
 */
export const cleanCompanyName = (companyName) => {
  if (!companyName) return '';
  
  // 한글, 영어, 숫자, 공백만 남기고 제거
  return companyName.replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, ' ')
                    .replace(/\s+/g, ' ')  // 여러 공백을 하나로
                    .trim();
};

/**
 * 주소에서 괄호 이후 텍스트 제거
 */
export const cleanAddress = (address) => {
  if (!address) return '';
  
  // 괄호 시작 부분 이후 텍스트 제거
  const parenIndex = address.indexOf('(');
  if (parenIndex !== -1) {
    return address.substring(0, parenIndex).trim();
  }
  return address.trim();
};

/**
 * 검색 쿼리 생성
 */
export const buildSearchQuery = (companyName, address) => {
  const cleanedCompany = cleanCompanyName(companyName);
  const cleanedAddress = cleanAddress(address);
  
  // 주소의 일부만 사용 (첫 번째 동/구 까지)
  let addressParts = cleanedAddress.split(' ');
  let shortAddress = '';
  
  // 주소가 너무 길면 동/구까지만 추출
  if (addressParts.length > 2) {
    // 동, 구, 로 등의 키워드를 포함한 부분까지만 포함
    const locationKeywords = ['동', '구', '로', '길', '읍', '면'];
    let cutIndex = 2; // 기본값으로 처음 2개 부분만 사용
    
    for (let i = 1; i < Math.min(4, addressParts.length); i++) {
      if (locationKeywords.some(keyword => addressParts[i].includes(keyword))) {
        cutIndex = i + 1;
        break;
      }
    }
    
    shortAddress = addressParts.slice(0, cutIndex).join(' ');
  } else {
    shortAddress = cleanedAddress;
  }
  
  // 검색 쿼리 구성
  return `${cleanedCompany} ${shortAddress}`.trim();
};

/**
 * 네이버 플레이스 URL 검색
 * @param {string} query - 검색할 쿼리
 * @param {boolean} includeCategory - 카테고리 정보도 함께 반환할지 여부 (기본값: false)
 * @returns {string|Object|''} includeCategory가 false면 URL 문자열만 반환, true면 {url, category} 객체 반환, 결과 없으면 빈 문자열
 */
export const searchNaverPlace = async (query, includeCategory = false) => {
  if (!query || query.trim() === '') {
    logger.warn('검색 쿼리가 비어있습니다.');
    return null;
  }
  
  try {
    logger.debug(`네이버 플레이스 검색 요청: ${query}`);
    
    // 모바일 UA/쿠키 가져오기
    const { ua, cookieStr } = loadMobileUAandCookies();
    logger.debug('모바일 UA/쿠키 설정 완료');
    
    // 네이버 지도 모바일 검색 URL (서울 중심 좌표 사용)
    const searchUrl = `https://m.place.naver.com/place/list?query=${encodeURIComponent(query)}&x=126.9783882&y=37.5666103`;
    
    // 요청 옵션 설정
    let fetchOptions = {
      headers: {
        'User-Agent': ua,
        'Cookie': cookieStr,
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      }
    };
    
    // 프록시 설정 (있는 경우)
    if (PROXY_SERVER && PROXY_SERVER.trim() !== '') {
      const agent = new HttpsProxyAgent(PROXY_SERVER);
      fetchOptions.agent = agent;
      logger.debug(`프록시 서버 사용: ${PROXY_SERVER}`);
    }
    
    const response = await fetch(searchUrl, fetchOptions);
    
    if (!response.ok) {
      logger.error(`네이버 플레이스 검색 실패: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // 광고가 아닌 첫 번째 검색 결과 찾기
    const placeItems = $('li.VLTHu').filter(function() {
      // 광고 항목 제외 (data-laim-exp-id가 undefined*e로 끝나는 항목)
      const expId = $(this).attr('data-laim-exp-id') || '';
      return !expId.includes('*e');
    });
    
    if (placeItems.length === 0) {
      logger.debug(`"${query}" 검색 결과 없음 (광고 제외)`);
      return ''; // null 대신 빈 문자열 반환
    }
    
    // 첫 번째 비광고 항목 정보 추출
    const firstItem = $(placeItems[0]);
    
    // 플레이스 URL 추출
    const placeUrl = firstItem.find('a.ApCpt.k4f_J').attr('href');
    
    if (!placeUrl) {
      logger.debug(`"${query}" 검색 결과에서 URL을 찾을 수 없음`);
      return ''; // null 대신 빈 문자열 반환
    }
    
    // 상대 경로를 절대 경로로 변환
    const fullPlaceUrl = placeUrl.startsWith('http') 
      ? placeUrl 
      : `https://m.place.naver.com${placeUrl}`;
    
    // 카테고리를 포함해야 하는 경우
    if (includeCategory) {
      // 업종 카테고리 추출
      const category = firstItem.find('span.YzBgS').text().trim();
      logger.debug(`검색 결과 URL 발견: ${fullPlaceUrl} (카테고리: ${category})`);
      return {
        url: fullPlaceUrl,
        category: category
      };
    }
    
    // 기본은 URL만 반환 (기존 동작과 호환성 유지)
    logger.debug(`검색 결과 URL 발견: ${fullPlaceUrl}`);
    return fullPlaceUrl;
    
  } catch (error) {
    logger.error(`네이버 플레이스 검색 중 오류: ${error.message}`);
    return null;
  }
};

/**
 * 고객 정보로 네이버 플레이스 URL 찾아서 저장
 */
export const findAndSaveNaverPlaceUrl = async (customerId, companyName, address) => {
  try {
    // 이미 URL이 있는지 확인
    const customer = await CustomerInfo.findByPk(customerId);
    if (!customer) {
      logger.warn(`ID ${customerId}인 고객 정보를 찾을 수 없습니다.`);
      return '';
    }
    
    // 이미 URL이 있으면 건너뛰기
    if (customer.naverplace_url) {
      logger.debug(`ID ${customerId}: 이미 네이버 플레이스 URL이 있습니다.`);
      return customer.naverplace_url;
    }
    
    // 검색 쿼리 생성
    const query = buildSearchQuery(companyName, address);
    
    // 네이버 플레이스 검색 (과도한 요청 방지를 위한 지연 추가)
    await randomDelay(1, 2);
    const placeUrl = await searchNaverPlace(query);
    
    if (placeUrl) {
      // URL 저장
      await customer.update({ naverplace_url: placeUrl });
      logger.debug(`ID ${customerId}: 네이버 플레이스 URL 저장 완료 - ${placeUrl}`);
      return placeUrl;
    }
    
    logger.debug(`ID ${customerId}: 네이버 플레이스 URL을 찾을 수 없습니다.`);
    return ''; // null 대신 빈 문자열 반환
  } catch (error) {
    logger.error(`네이버 플레이스 URL 생성 중 오류 (ID ${customerId}): ${error.message}`);
    return null;
  }
};

/**
 * 여러 고객 정보의 네이버 플레이스 URL을 한 번에 처리
 */
export const batchProcessNaverPlaceUrls = async (customerIds) => {
  const results = {
    success: 0,
    failed: 0,
    skipped: 0
  };
  
  if (!customerIds || customerIds.length === 0) {
    logger.warn('처리할 고객 ID가 없습니다.');
    return results;
  }
  
  logger.debug(`${customerIds.length}개 고객의 네이버 플레이스 URL 일괄 처리 시작`);
  
  for (const customerId of customerIds) {
    try {
      const customer = await CustomerInfo.findByPk(customerId);
      if (!customer) {
        logger.warn(`ID ${customerId}인 고객 정보를 찾을 수 없습니다.`);
        results.failed++;
        continue;
      }
      
      // 이미 URL이 있으면 건너뛰기
      if (customer.naverplace_url) {
        logger.debug(`ID ${customerId}: 이미 네이버 플레이스 URL이 있습니다.`);
        results.skipped++;
        continue;
      }
      
      const placeUrl = await findAndSaveNaverPlaceUrl(
        customerId, 
        customer.company_name, 
        customer.address
      );
      
      if (placeUrl) {
        results.success++;
      } else {
        results.failed++;
      }
      
      // 과도한 요청 방지를 위한 지연
      await randomDelay(1, 3);
      
    } catch (error) {
      logger.error(`ID ${customerId} 처리 중 오류: ${error.message}`);
      results.failed++;
    }
  }
  
  logger.debug(`네이버 플레이스 URL 일괄 처리 완료: 성공 ${results.success}, 실패 ${results.failed}, 건너뜀 ${results.skipped}`);
  return results;
};

// 기본 내보내기 객체
export default {
  cleanCompanyName,
  cleanAddress,
  buildSearchQuery,
  searchNaverPlace,
  findAndSaveNaverPlaceUrl,
  batchProcessNaverPlaceUrls
};
