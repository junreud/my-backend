// 컨트롤러 - 비즈니스 로직 담당

import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import 'dotenv/config';
import { createLogger } from '../lib/logger.js';
import fetch from 'node-fetch';
import { loadAlbamonUAandCookies } from '../config/albamonConfig.js';
import CustomerInfo from '../models/CustomerInfo.js';
import ContactInfo from '../models/ContactInfo.js';
import { getLoggedInSession } from '../config/albamonConfig.js';
import { randomDelay } from '../config/crawler.js';

const logger = createLogger('AlbamonController');

// 메인 컨트롤러 - URL 기반 크롤링
export const crawlAlbamonController = async (req, res) => {
  try {
    logger.debug('crawlAlbamonController 함수 시작');
    logger.debug(`요청 본문: ${JSON.stringify(req.body)}`);
    
    // URL 기반 크롤링 요청 처리
    if (req.body.urls && Array.isArray(req.body.urls)) {
      logger.debug('URLs 배열 확인됨, crawlAlbamonFromUrls 호출');
      return await crawlAlbamonFromUrls(req, res);
    }
    
    // 잘못된 요청 형식
    logger.error(`알 수 없는 요청 형식: ${JSON.stringify(req.body)}`);
    return res.status(400).json({ 
      success: false, 
      message: "올바른 요청 형식이 아닙니다. 'urls' 배열이 필요합니다." 
    });
  } catch (error) {
    logger.error(`crawlAlbamonController 처리 중 예외: ${error}`);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// URL에서 view-source 제거
const cleanUrl = (url) => url.replace(/^view-source:/, '');

// HTML에서 공고 수 추출
const extractTotalCount = ($, type) => {
  if (type === 'search') {
    const titleText = $('title').text();
    const totalCountMatch = titleText.match(/(\d+(?:,\d+)*)건의?\s*(?:공고|검색결과)/);
    if (totalCountMatch && totalCountMatch[1]) {
      return parseInt(totalCountMatch[1].replace(/,/g, ''), 10);
    }
    const countElement = $('.list-header__count-value, .sr-count');
    if (countElement.length) {
      return parseInt(countElement.text().replace(/[^0-9]/g, ''), 10);
    }
  } else {
    const countElement = $('.list-header__count-value, .area-jobs-count');
    if (countElement.length) {
      return parseInt(countElement.text().replace(/[^0-9]/g, ''), 10);
    }
    const titleText = $('title').text();
    const totalCountMatch = titleText.match(/(\d+(?:,\d+)*)건의?\\s*일자리/);
    if (totalCountMatch && totalCountMatch[1]) {
      return parseInt(totalCountMatch[1].replace(/,/g, ''), 10);
    }
  }
  return 0;
};

// 통합 검색 페이지 파싱
const parseSearchPage = ($) => {
  const results = [];

  $('.list-item-recruit--search').each((_, el) => {
    try {
      const linkElement = $(el).find('a.list-item-recruit__link');
      let jobId = '';
      if (linkElement.length) {
        const href = linkElement.attr('href');
        if (href) {
          const match = href.match(/\/detail\/([^?]+)/);
          if (match && match[1]) {
            jobId = match[1];
          }
        }
      }

      const jobTitle = $(el).find('span.typography-paid').text().trim();
      const companyName = $(el).find('.list-item-recruit__grey-text').first().text().trim();
      const address = $(el).find('.list-item-recruit__work').text().trim();

      if (jobId && jobTitle && companyName && address) {
        results.push({ jobId, jobTitle, companyName, address });
      }
    } catch (err) {
      console.warn('[WARN] 항목 파싱 중 오류:', err.message);
    }
  });

  return results;
};

// 지역별 페이지 파싱
const parseAreaPage = ($) => {
  const results = [];

  $('.list-item-recruit--area').each((_, el) => {
    try {
      const linkElement = $(el).find('a.list-item-recruit__link');
      let jobId = '';
      if (linkElement.length) {
        const href = linkElement.attr('href');
        if (href) {
          const match = href.match(/\/detail\/([^?]+)/);
          if (match && match[1]) {
            jobId = match[1];
          }
        }
      }

      const jobTitle = $(el).find('.typography-paid').text().trim();
      const companyName = $(el).find('.ListItemRecruit_list-item-recruit__company-name__bbljH').text().trim();
      const address = $(el).find('.list-item-recruit__work').text().trim();

      if (jobId && jobTitle && companyName && address) {
        results.push({ jobId, jobTitle, companyName, address });
      }
    } catch (err) {
      console.warn('[WARN] 항목 파싱 중 오류:', err.message);
    }
  });

  return results;
};

// HTTP 요청을 위한 공통 헤더 생성
const getCommonHeaders = (cookieStr, ua) => {
  return {
    'Cookie': cookieStr,
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'ko-KR,ko;q=0.9',
  };
};

// 타임아웃 가능한 fetch 함수
const fetchWithTimeout = async (url, options, timeout = 15000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

// URL 기반 크롤링 컨트롤러
export const crawlAlbamonFromUrls = async (req, res) => {
  const { urls } = req.body;
  const size = 50; // 페이지당 아이템 수
  const results = [];

  try {
    // 쿠키 및 UA 로드
    const { ua, cookieStr } = await loadAlbamonUAandCookies();
    logger.debug('알바몬 쿠키 및 UA 로드 성공');

    for (let originalUrl of urls) {
      const url = cleanUrl(originalUrl);
      logger.debug(`처리 중인 URL: ${url}`);
      
      // URL 타입 확인 (통합검색 vs 지역별)
      const isSearch = url.includes('total-search');
      const isArea = url.includes('/jobs/');
      
      if (!isSearch && !isArea) {
        logger.warn(`지원하지 않는 URL 형식: ${url}`);
        continue;
      }
      
      logger.debug(`URL 타입: ${isSearch ? '통합검색' : '지역별'}`);
      
      try {
        // 초기 요청으로 총 개수 확인
        const initialResponse = await fetchWithTimeout(
          url, 
          { method: 'GET', headers: getCommonHeaders(cookieStr, ua) }
        );
        
        if (!initialResponse.ok) {
          throw new Error(`Failed to fetch URL ${url}: ${initialResponse.status} ${initialResponse.statusText}`);
        }
        
        const initialHtml = await initialResponse.text();
        const $ = cheerio.load(initialHtml);
        
        // 총 결과 수 추출
        const totalCount = extractTotalCount($, isSearch ? 'search' : 'area');
        const totalPages = Math.ceil(totalCount / size);
        logger.debug(`총 공고 수: ${totalCount}, 총 페이지: ${totalPages}`);
        
        // 각 페이지를 순회하며 결과 추출
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          const pageUrl = new URL(url);
          pageUrl.searchParams.set('page', pageNum);
          pageUrl.searchParams.set('size', size);
          
          logger.debug(`페이지 ${pageNum}/${totalPages} 요청: ${pageUrl.toString()}`);
          
          const pageResponse = await fetchWithTimeout(
            pageUrl.toString(),
            { method: 'GET', headers: getCommonHeaders(cookieStr, ua) }
          );
          
          if (!pageResponse.ok) {
            throw new Error(`Failed to fetch page ${pageNum}: ${pageResponse.status} ${pageResponse.statusText}`);
          }
          
          const pageHtml = await pageResponse.text();
          const $$ = cheerio.load(pageHtml);
          
          // URL 타입에 따라 다른 파싱 로직 적용
          const parsedResults = isSearch ? parseSearchPage($$) : parseAreaPage($$);
          logger.debug(`페이지 ${pageNum} 파싱 완료, ${parsedResults.length}개 항목 추가`);
          
          results.push(...parsedResults);
          
          // 과도한 요청 방지를 위한 지연
          if (pageNum < totalPages) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } catch (urlError) {
        logger.error(`URL 처리 중 오류: ${urlError.message}`);
      }
    }
    
    // 중복 제거 로직 추가
    logger.debug(`중복 제거 전 항목 수: ${results.length}`);
    
    // 중복 제거를 위한 Set 객체 (주소+업체명 또는 주소+공고제목이 같은 경우 중복으로 판단)
    const uniqueKeys = new Set();
    const uniqueResults = [];
    
    for (const item of results) {
      // 주소+업체명과 주소+공고제목으로 중복 키 생성
      const addressCompanyKey = `${item.address}|${item.companyName}`.toLowerCase();
      const addressTitleKey = `${item.address}|${item.jobTitle}`.toLowerCase();
      
      // 중복 체크
      if (!uniqueKeys.has(addressCompanyKey) && !uniqueKeys.has(addressTitleKey)) {
        // 중복 아님 - 결과에 추가하고 키를 Set에 저장
        uniqueResults.push(item);
        uniqueKeys.add(addressCompanyKey);
        uniqueKeys.add(addressTitleKey);
      } else {
        logger.debug(`중복 항목 제거: ${item.companyName} - ${item.jobTitle}`);
      }
    }
    
    logger.debug(`중복 제거 후 항목 수: ${uniqueResults.length}`);
    logger.debug(`총 ${results.length - uniqueResults.length}개 중복 항목 제거됨`);
    
    res.json({ success: true, data: uniqueResults });
  } catch (error) {
    logger.error(`크롤링 중 예외 발생: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 상세 페이지 크롤링 함수 수정
const crawlDetailPageById = async (id) => {
    const url = `https://www.albamon.com/jobs/detail/${id}`;
    
    logger.debug(`ID ${id} 상세 페이지 크롤링 시작`);
    
    // 쿠키 로드
    let cookieData;
    try {
      // 쿠키 및 UA 로드
      const { ua, cookieStr, cookies } = await loadAlbamonUAandCookies();
      cookieData = { ua, cookies };
      logger.debug(`ID ${id} 크롤링을 위한 쿠키 로드 성공`);
    } catch (cookieError) {
      logger.error(`쿠키 로드 중 오류: ${cookieError.message}`);
    }
    
    const browser = await chromium.launch({ headless: false }); // 실제 작동 시에는 headless: true로 변경
    const context = await browser.newContext({
      userAgent: cookieData?.ua // 사용자 에이전트 설정
    });
    
    // 쿠키 설정 (로그인 상태 유지)
    if (cookieData?.cookies) {
      await context.addCookies(cookieData.cookies);
      logger.debug(`브라우저에 쿠키 적용됨 (${cookieData.cookies.length}개)`);
    }
    
    const page = await context.newPage();
  
    try {
      logger.debug(`URL로 이동: ${url}`);
      await page.goto(url, { timeout: 60000 });
      await page.waitForLoadState('networkidle');
  
      // 로그인 상태 확인
      const isLoggedIn = await page.evaluate(() => {
        return document.body.textContent.includes('로그아웃') || 
               !document.body.textContent.includes('로그인');
      });
      
      if (!isLoggedIn) {
        logger.warn(`ID ${id} 크롤링: 로그인 상태가 아님`);
      } else {
        logger.debug(`ID ${id} 크롤링: 로그인 상태 확인됨`);
      }
  
      const html = await page.content();
      const $ = cheerio.load(html);
  
      const companyName = $('div.company-info strong').text().trim() || '';
      const address = $('p.detail-recruit-area__address').text().replace('복사', '').trim() || '';
  
      // iframe 접근하여 전화번호, 담당자 추출
      let phone = '';
      let contactPerson = '';
  
      const iframeElement = await page.$('iframe[title="담당자 정보"]');
      if (iframeElement) {
        logger.debug(`ID ${id} iframe 요소 발견`);
        const frame = await iframeElement.contentFrame();
        if (frame) {
          try {
            // 타임아웃 증가 및 폴링 간격 조정
            await frame.waitForSelector('dt:has-text("전화") + dd div', { 
              timeout: 10000,
              polling: 500
            });
            
            const phoneNumbers = await frame.$$eval(
              'dt:has-text("전화") + dd div',
              els => els.map(el => el.textContent.trim())
            );
            
            logger.debug(`ID ${id} 전화번호 추출: ${phoneNumbers.length}개 발견`);
            phone = phoneNumbers.find(num => num.startsWith('010')) || phoneNumbers[0] || '';
  
            // 담당자 정보 추출
            try {
              contactPerson = await frame.$eval(
                'dt:has-text("담당자") + dd',
                el => el.textContent.trim()
              );
              logger.debug(`ID ${id} 담당자 추출: ${contactPerson}`);
            } catch (personError) {
              logger.warn(`ID ${id} 담당자 정보 추출 실패: ${personError.message}`);
              
              // 대체 선택자 시도
              try {
                const dtElements = await frame.$$('dt');
                for (const dt of dtElements) {
                  const text = await dt.textContent();
                  if (text.includes('담당자')) {
                    const dd = await dt.$eval('+ dd', el => el.textContent.trim());
                    contactPerson = dd;
                    logger.debug(`ID ${id} 담당자 추출(대체): ${contactPerson}`);
                    break;
                  }
                }
              } catch (altError) {
                logger.warn(`ID ${id} 대체 담당자 정보 추출도 실패: ${altError.message}`);
              }
            }
          } catch (frameError) {
            logger.warn(`ID ${id} iframe 내 정보 추출 중 오류: ${frameError.message}`);
            
            // 디버깅을 위한 스크린샷 캡처 (실제 운영시 비활성화)
            try {
              await frame.screenshot({ path: `debug-frame-${id}.png` });
              logger.debug(`ID ${id} iframe 스크린샷 저장됨`);
            } catch (screenshotError) {
              logger.warn(`스크린샷 저장 실패: ${screenshotError.message}`);
            }
          }
        } else {
          logger.warn(`ID ${id} iframe의 contentFrame을 가져오지 못함`);
        }
      } else {
        logger.warn(`ID ${id} iframe 요소를 찾지 못함`);
      }
  
      await browser.close();
      
      return {
        success: true,
        companyName,
        address,
        phone,
        contactPerson,
        detailLink: url
      };
    } catch (error) {
      try {
        // 오류 디버깅을 위한 스크린샷
        await page.screenshot({ path: `error-page-${id}.png` });
        logger.debug(`ID ${id} 오류 페이지 스크린샷 저장됨`);
      } catch (screenshotError) {
        logger.warn(`스크린샷 저장 실패: ${screenshotError.message}`);
      }
      
      await browser.close();
      logger.error(`ID ${id} 상세 정보 크롤링 중 오류: ${error.message}`);
      throw error;
    }
  };

// 상세 페이지 크롤링 - API 엔드포인트용
export const crawlAlbamonById = async (req, res) => {
  const { id } = req.params;
  
  logger.debug(`ID로 상세 정보 조회 시작: ${id}`);
  
  try {
    const detailData = await crawlDetailPageById(id);
    
    const data = {
      companyName: detailData.companyName,
      address: detailData.address,
      phone: detailData.phone,
      name: detailData.contactPerson,
      detailLink: detailData.detailLink,
    };
    
    logger.debug(`ID ${id} 상세 정보 파싱 완료`);
    res.json({ success: true, data });
  } catch (error) {
    logger.error(`ID ${id} 상세 정보 파싱 중 오류: ${error}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 여러 비즈니스 상세 정보 크롤링 및 DB 저장
export const processBusinessContacts = async (req, res) => {
  logger.debug('processBusinessContacts 함수 시작 - batchProcessJobIds로 리디렉션');
  return batchProcessJobIds(req, res);
};

// 여러 ID를 한 번의 로그인 세션으로 처리하는 함수
export const batchProcessJobIds = async (req, res) => {
  const { businesses } = req.body;
  
  if (!Array.isArray(businesses) || businesses.length === 0) {
    return res.status(400).json({
      success: false,
      message: "유효한 businesses 배열이 필요합니다"
    });
  }
  
  logger.debug(`총 ${businesses.length}개 공고 처리 시작`);
  
  try {
    // 로그인 세션 가져오기
    const { browser, context } = await getLoggedInSession();
    logger.debug('로그인 세션 생성 성공');
    
    const results = [];
    const errors = [];
    
    // 병렬 처리를 위한 설정
    const concurrency = 5; // 동시에 처리할 최대 페이지 수
    const delay = 500; // 각 ID 처리 사이의 지연 시간 (ms)
    
    // 작은 배치로 나누어 처리
    for (let i = 0; i < businesses.length; i += concurrency) {
      const batch = businesses.slice(i, i + concurrency);
      logger.debug(`배치 처리: ${i+1}-${Math.min(i+concurrency, businesses.length)}/${businesses.length}`);
      
      // 현재 배치의 모든 작업을 병렬로 처리
      const batchPromises = batch.map(async (business, index) => {
        // 과도한 동시 요청 방지를 위한 지연
        await new Promise(r => setTimeout(r, index * delay));
        
        try {
          const jobId = business.jobId || business.id;
          
          if (!jobId) {
            return { business, error: "유효한 ID가 없습니다" };
          }
          
          logger.debug(`ID ${jobId} 처리 시작`);
          
          const existingCustomer = await CustomerInfo.findOne({
            where: { posting_id: jobId },
            include: [{
              model: ContactInfo,
              attributes: ['phone_number', 'contact_person']
            }]
          });
          
          if (existingCustomer?.ContactInfos?.length > 0) {
            return {
              success: true,
              data: {
                jobId,
                companyName: existingCustomer.company_name,
                phone: existingCustomer.ContactInfos[0].phone_number,
                contactPerson: existingCustomer.ContactInfos[0].contact_person,
                address: existingCustomer.address,
                fromCache: true
              }
            };
          }
          
          const page = await context.newPage();
          const url = `https://www.albamon.com/jobs/detail/${jobId}`;
          
          try {
            await page.goto(url, { timeout: 30000 });
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            
            const html = await page.content();
            const $ = cheerio.load(html);
            
            const companyName = $('div.company-info strong').text().trim() || business.businessName || business.companyName || null;
            const address = $('p.detail-recruit-area__address').text().replace('복사', '').trim() || business.address || null;
            
            let phone = null;
            let contactPerson = null;
            
            const iframeElement = await page.$('iframe[title="담당자 정보"]');
            if (iframeElement) {
              const frame = await iframeElement.contentFrame();
              if (frame) {
                try {
                  await frame.waitForTimeout(500); // iframe 로드 대기
                  await frame.waitForSelector('dt:has-text("전화") + dd div', { timeout: 5000 }).catch(() => {});
                  const phoneElements = await frame.$$('dt:has-text("전화") + dd div');
                  
                  if (phoneElements.length > 0) {
                    const phoneNumbers = await Promise.all(
                      phoneElements.map(el => frame.evaluate(node => node.textContent.trim(), el))
                    );
                    phone = phoneNumbers.find(num => num.startsWith('010')) || phoneNumbers[0] || null;
                  }
                  
                  const personElement = await frame.$('dt:has-text("담당자") + dd');
                  if (personElement) {
                    contactPerson = await frame.evaluate(node => node.textContent.trim(), personElement);
                  }
                } catch (frameErr) {
                  logger.warn(`ID ${jobId}: iframe 처리 중 오류: ${frameErr.message}`);
                }
              }
            }
            
            await page.close();
            
            // 특정 담당자 키워드가 있는 경우 필터링
            const filterKeywords = ['채용담당자', '인사담당자', '담당자', '매니저', '담당채용자', '점장'];
            
            if (contactPerson && filterKeywords.some(keyword => contactPerson.includes(keyword))) {
              logger.debug(`ID ${jobId}: 필터링된 담당자 키워드 발견: "${contactPerson}" - 데이터 저장 건너뜀`);
              
              // 이미 존재하는 고객 정보가 있다면 삭제
              if (existingCustomer) {
                // 먼저 관련 연락처 정보 삭제
                await ContactInfo.destroy({ where: { customer_id: existingCustomer.id } });
                // 고객 정보 삭제
                await existingCustomer.destroy();
                logger.debug(`ID ${jobId}: 필터링으로 인해 기존 고객 및 연락처 정보 삭제됨`);
              }
              
              return {
                success: true,
                data: {
                  jobId,
                  filtered: true,
                  filterReason: `담당자 키워드 필터링: "${contactPerson}"` 
                }
              };
            }
            
            let customer = existingCustomer;
            if (!customer) {
              customer = await CustomerInfo.create({
                posting_id: jobId,
                title: business.postTitle || business.jobTitle || '',
                company_name: companyName,
                address: address
              });
            }
            
            await ContactInfo.create({
              customer_id: customer.id,
              phone_number: phone,
              contact_person: contactPerson
            });
            
            return {
              success: true,
              data: {
                jobId,
                companyName,
                phone,
                contactPerson,
                address,
                fromCache: false
              }
            };
          } catch (pageError) {
            await page.close();
            throw pageError;
          }
        } catch (businessError) {
          logger.error(`ID ${business.id || business.jobId}: 처리 중 오류: ${businessError.message}`);
          return { business, error: businessError.message };
        }
      });
      
      // 현재 배치의 모든 결과 수집
      const batchResults = await Promise.all(batchPromises);
      
      // 결과 및 오류 분류
      batchResults.forEach(result => {
        if (result.success) {
          results.push(result.data);
        } else {
          errors.push(result);
        }
      });
      
      // 다음 배치 전 지연 (서버 부하 방지)
      if (i + concurrency < businesses.length) {
        logger.debug(`다음 배치 처리 전 ${delay * 2}ms 대기`);
        await randomDelay(1, 2);
        }
    }
    
    await browser.close();
    logger.debug('브라우저 세션 종료됨');
    
    return res.json({
      success: true,
      totalProcessed: businesses.length,
      successCount: results.length,
      errorCount: errors.length,
      data: results,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    logger.error(`배치 처리 중 오류 발생: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// DB 조회 함수들

// 모든 고객 정보 조회
export const getAllCustomers = async (req, res) => {
  try {
    logger.debug('모든 고객 정보 조회 요청');
    
    const customers = await CustomerInfo.findAll({
      include: [{
        model: ContactInfo,
        attributes: ['phone_number', 'contact_person']
      }]
    });
    
    return res.json({
      success: true,
      count: customers.length,
      data: customers
    });
  } catch (error) {
    logger.error(`고객 정보 조회 중 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 특정 고객 정보 조회 (ID 기준)
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    logger.debug(`고객 ID ${id} 조회 요청`);
    
    const customer = await CustomerInfo.findByPk(id, {
      include: [{
        model: ContactInfo,
        attributes: ['phone_number', 'contact_person']
      }]
    });
    
    if (!customer) {
      logger.warn(`ID ${id}에 해당하는 고객 정보 없음`);
      return res.status(404).json({
        success: false,
        message: '해당 ID의 고객 정보를 찾을 수 없습니다'
      });
    }
    
    return res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    logger.error(`고객 정보 조회 중 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 특정 공고 ID로 고객 정보 조회
export const getCustomerByPostingId = async (req, res) => {
  try {
    const { postingId } = req.params;
    logger.debug(`공고 ID ${postingId} 조회 요청`);
    
    const customer = await CustomerInfo.findOne({
      where: { posting_id: postingId },
      include: [{
        model: ContactInfo,
        attributes: ['phone_number', 'contact_person']
      }]
    });
    
    if (!customer) {
      logger.warn(`공고 ID ${postingId}에 해당하는 고객 정보 없음`);
      return res.status(404).json({
        success: false,
        message: '해당 공고 ID의 고객 정보를 찾을 수 없습니다'
      });
    }
    
    return res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    logger.error(`고객 정보 조회 중 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 특정 공고 ID로 연락처 정보 모두 조회
export const getContactsByPostingId = async (req, res) => {
  try {
    const { postingId } = req.params;
    logger.debug(`공고 ID ${postingId}의 모든 연락처 조회 요청`);
    
    // 수정: 올바른 조회 방식으로 변경
    const customer = await CustomerInfo.findOne({
      where: { posting_id: postingId }
    });
    
    if (!customer) {
      logger.warn(`공고 ID ${postingId}에 해당하는 고객 정보 없음`);
      return res.status(404).json({
        success: false,
        message: '해당 공고 ID의 고객 정보를 찾을 수 없습니다'
      });
    }
    
    const contacts = await ContactInfo.findAll({
      where: { customer_id: customer.id },
      include: [{
        model: CustomerInfo,
        attributes: ['title', 'company_name', 'address']
      }]
    });
    
    if (!contacts || contacts.length === 0) {
      logger.warn(`고객 ID ${customer.id}에 해당하는 연락처 정보 없음`);
      return res.status(404).json({
        success: false,
        message: '해당 공고 ID의 연락처 정보를 찾을 수 없습니다'
      });
    }
    
    return res.json({
      success: true,
      count: contacts.length,
      data: contacts
    });
  } catch (error) {
    logger.error(`연락처 정보 조회 중 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};