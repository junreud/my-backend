// 컨트롤러 - 비즈니스 로직 담당
import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import * as cheerio from 'cheerio';
import 'dotenv/config';
import { createLogger } from '../lib/logger.js';
import fetch from 'node-fetch';
import { loadAlbamonUAandCookies } from '../config/albamonConfig.js';
import { getLoggedInSession } from '../config/albamonConfig.js';
import { randomDelay } from '../config/crawler.js';
import { io } from '../server.js';
import { CustomerInfo, ContactInfo, CustomerContactMap } from '../models/index.js';
import * as albamonService from '../services/albamonService.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';

const logger = createLogger('AlbamonController');
const { sendSuccess, sendError, handleDbOperation, validateRequiredFields } = createControllerHelper('AlbamonController');

// 메인 컨트롤러 - URL 기반 크롤링
export const crawlAlbamonController = async (req, res) => {
  try {
    const { urls } = req.body;
    
    // Validate required fields
    const validation = validateRequiredFields(req.body, ['urls']);
    if (validation) {
      return sendError(res, 400, validation.message);
    }
    
    if (!Array.isArray(urls)) {
      return sendError(res, 400, "'urls'는 배열이어야 합니다.");
    }
    
    const data = await handleDbOperation(async () => {
      return await albamonService.crawlFromUrls(urls);
    }, "URL 크롤링");
    
    return sendSuccess(res, data);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// 여러 비즈니스 상세 정보 크롤링 및 DB 저장
export const processBusinessContacts = async (req, res) => {
  try {
    const businesses = req.body.businesses;
    
    // Validate required fields
    const validation = validateRequiredFields(req.body, ['businesses']);
    if (validation) {
      return sendError(res, 400, validation.message);
    }
    
    if (!Array.isArray(businesses) || businesses.length === 0) {
      return sendError(res, 400, '유효한 businesses 배열이 필요합니다');
    }
    
    const result = await handleDbOperation(async () => {
      return await albamonService.batchProcessJobIds(businesses, io);
    }, "비즈니스 연락처 처리");
    
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// 여러 ID를 한 번의 로그인 세션으로 처리하는 함수
export const batchProcessJobIds = async (req, res) => {
    try {
      const { businesses } = req.body;
      
      // Validate required fields
      const validation = validateRequiredFields(req.body, ['businesses']);
      if (validation) {
        return sendError(res, 400, validation.message);
      }
      
      if (!Array.isArray(businesses) || businesses.length === 0) {
        return sendError(res, 400, "유효한 businesses 배열이 필요합니다");
      }
      
      logger.debug(`총 ${businesses.length}개 공고 처리 시작`);
      
      // 초기 진행 상태 전송
      io.emit('progressUpdate', {
        completed: 0,
        total: businesses.length,
        percent: 0
      });
      
      // 크롤링 준비 - 중복 제거된 공고 ID 목록 생성
    io.emit('progressUpdate', {
      completed: 0,
      total: businesses.length,
      percent: 0
    });
    
    try {
      // 크롤링 준비 - 중복 제거된 공고 ID 목록 생성
      logger.debug('크롤링 준비: 중복 제거 및 유효성 검증');
      
      // 유효한 jobId 목록 구성
      const uniqueJobIds = new Set();
      const jobsToProcess = [];
      
      for (const business of businesses) {
        const jobId = business.jobId || business.id;
        
        if (!jobId) {
          logger.warn('유효한 ID가 없는 비즈니스 항목 무시');
          continue;
        }
        
        // 중복된 jobId는 처리하지 않음
        if (uniqueJobIds.has(jobId)) {
          logger.debug(`중복 jobId 발견, 스킵: ${jobId}`);
          continue;
        }
        
        // 이미 저장된 정보가 있는지 확인
        const existingCustomer = await CustomerInfo.findOne({
          where: { posting_id: jobId },
          include: [{
            model: ContactInfo,
            attributes: ['phone_number', 'contact_person']
          }]
        });
        
        // 이미 연락처 정보가 있는 경우 추가 크롤링 불필요
        if (existingCustomer?.ContactInfos?.length > 0 && existingCustomer.ContactInfos[0].phone_number) {
          logger.debug(`ID ${jobId}: 기존 정보 발견, 크롤링 생략`);
          continue;
        }
        
        // 중복 체크를 위해 추가 (같은 주소와 제목/업체명이 있는지)
        const title = business.postTitle || business.jobTitle || '';
        const companyName = business.businessName || business.companyName || '';
        const address = business.address || '';
        
        if (address && (title || companyName)) {
          const duplicateCustomer = await CustomerInfo.findOne({
            where: {
              [Op.or]: [
                { address, title },
                { address, company_name: companyName }
              ]
            }
          });
          
          if (duplicateCustomer) {
            logger.debug(`중복된 업체 발견 (주소+제목 또는 주소+업체명): ${address}, ${title || companyName}`);
            continue;
          }
        }
        
        // source_filter 자동 조합
        // (1) 파싱종류: area → '지역', total → '검색'
        const parsingType = business.parsingType || business.parsing_type || '';
        const region = business.region || '';
        const includeKeywords = business.includeKeywords || business.include_keywords || '';
        const excludeKeywords = business.excludeKeywords || business.exclude_keywords || '';
        let parsingTypeLabel = '';
        if (parsingType === 'area') parsingTypeLabel = '지역';
        else if (parsingType === 'total') parsingTypeLabel = '검색';
        else parsingTypeLabel = parsingType;

        let regionValue = '';
        if (parsingType === 'area') {
          regionValue = Array.isArray(region) ? region.join('&') : region;
        } else if (parsingType === 'total') {
          regionValue = includeKeywords || '';
        }

        let sourceFilterParts = [];
        if (parsingTypeLabel) {
          sourceFilterParts.push(`파싱종류:${parsingTypeLabel}`);
        }
        if (regionValue) {
          sourceFilterParts.push(`지역:${regionValue}`);
        }
        if (includeKeywords) {
          const includeStr = Array.isArray(includeKeywords) ? includeKeywords.join(',') : includeKeywords;
          sourceFilterParts.push(`포함:${includeStr}`);
        }
        if (excludeKeywords) {
          const excludeStr = Array.isArray(excludeKeywords) ? excludeKeywords.join(',') : excludeKeywords;
          sourceFilterParts.push(`제외:${excludeStr}`);
        }
        const source_filter = sourceFilterParts.join(', ');

        // 중복 없음, 크롤링 대상에 추가
        uniqueJobIds.add(jobId);
        jobsToProcess.push({
          jobId,
          title,
          companyName,
          address,
          source_filter
        });
      }
      
      logger.debug(`크롤링할 고유 공고 ID 수: ${jobsToProcess.length}`);
      
      // 데이터 수집 단계: 최종 저장할 데이터 목록
      const customersToSave = []; // 최종 저장할 고객 정보 목록
      const results = [];
      const errors = [];
      
      if (jobsToProcess.length > 0) {
        // 로그인 세션 생성 
        const { browser, context } = await getLoggedInSession();
        logger.debug('로그인 세션 생성 성공');
        
        // 병렬 처리를 위한 설정
        const concurrency = 6; // 동시에 처리할 최대 페이지 수
        const delay = 300; // 각 ID 처리 사이의 지연 시간 (ms)
        
        let completedCount = 0;
        
        // 작은 배치로 나누어 처리
        for (let i = 0; i < jobsToProcess.length; i += concurrency) {
          const batch = jobsToProcess.slice(i, i + concurrency);
          logger.debug(`배치 크롤링: ${i+1}-${Math.min(i+concurrency, jobsToProcess.length)}/${jobsToProcess.length}`);
          
            // 현재 배치의 모든 작업을 병렬로 처리
            const batchPromises = batch.map(async (item, index) => {
                // 과도한 동시 요청 방지를 위한 지연
                await new Promise(r => setTimeout(r, index * delay));
                
                const { jobId, title, companyName, address } = item;
                
                try {
                logger.debug(`ID ${jobId} 크롤링 시작`);
                
                const page = await context.newPage();
                const url = `https://www.albamon.com/jobs/detail/${jobId}`;
                
                try {
                    await page.goto(url, { timeout: 30000 });
                    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                    
                    const html = await page.content();
                    const $ = cheerio.load(html);
                    
                    // 상세 페이지에서 회사명, 주소 정보 추출 
                    const detailCompanyName = $('div.company-info strong').text().trim();
                    const detailAddress = $('p.detail-recruit-area__address').text().replace('복사', '').trim();
                    
                    // 전화번호, 담당자 정보 추출
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
                            
                            // 안심번호 필터링 로직 
                            if (phone && phone.includes('안심번호')) {
                            logger.debug(`ID ${jobId}: 안심번호 발견: "${phone}", 저장 건너뜀`);
                            await page.close();
                            return { success: false, error: '안심번호 발견' };
                            }
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
                    
                    // 전화번호가 없는 경우 필터링
                    if (!phone || phone === '') {
                    logger.debug(`ID ${jobId}: 전화번호 없음, 저장 건너뜀`);
                    return { success: false, error: '전화번호 없음' };
                    }
                    
                    // 특정 담당자 키워드가 있는 경우 필터링
                    const filterKeywords = ['채용담당자', '인사담당자', '담당자', '매니저', '담당채용자', '점장', '채용담당', '매니져', '인사담당'];
                    if (contactPerson && filterKeywords.some(keyword => contactPerson.includes(keyword))) {
                      logger.debug(`ID ${jobId}: 필터링된 담당자 키워드 발견: "${contactPerson}", 저장 건너뜀`);
                      // 이미 DB에 저장된 정보가 있는지 확인하고 삭제
                      const existingCustomer = await CustomerInfo.findOne({
                        where: { posting_id: jobId }
                      });
                      if (existingCustomer) {
                        logger.debug(`ID ${jobId}: 담당자 키워드로 인해 DB에서 삭제`);
                        await ContactInfo.destroy({ where: { customer_id: existingCustomer.id } });
                        await existingCustomer.destroy();
                      }
                      return {
                        success: true,
                        data: {
                          jobId,
                          filtered: true,
                          filterReason: `담당자명 필터링: \"${contactPerson}\"`
                        }
                      };
                    }
                    
                    // 실시간 DB 저장
                    let customer = await CustomerInfo.findOne({ where: { posting_id: jobId } });
                    if (!customer) {
                    customer = await CustomerInfo.create({
                        posting_id: jobId,
                        title: title || detailCompanyName,
                        company_name: detailCompanyName || companyName,
                        address: detailAddress || address,
                        source_filter: item.source_filter
                    });
                    } else {
                    await CustomerInfo.update({
                        title: title || detailCompanyName,
                        company_name: detailCompanyName || companyName,
                        address: detailAddress || address,
                        source_filter: item.source_filter
                    }, { where: { id: customer.id } });
                    }
                    
                    let contact = await ContactInfo.findOne({
                    where: {
                        phone_number: phone,
                        contact_person: contactPerson
                    }
                    });
                    
                    if (!contact) {
                    contact = await ContactInfo.create({
                        phone_number: phone,
                        contact_person: contactPerson
                    });
                    }
                    
                    const exists = await CustomerContactMap.findOne({
                    where: {
                        customer_id: customer.id,
                        contact_id: contact.id
                    }
                    });
                    
                    if (!exists) {
                    await CustomerContactMap.create({
                        customer_id: customer.id,
                        contact_id: contact.id
                    });
                    }
                    
                    logger.debug(`ID ${jobId}: 실시간 저장 완료`);
                    return { success: true, data: { jobId } };
                } catch (pageError) {
                    await page.close();
                    logger.error(`ID ${jobId}: 페이지 처리 중 오류: ${pageError.message}`);
                    return { success: false, error: pageError.message };
                }
                } catch (error) {
                logger.error(`ID ${jobId}: 처리 중 오류: ${error.message}`);
                return { success: false, error: error.message };
                } finally {
                // 진행 상태 업데이트
                completedCount++;
                const percent = Math.round((completedCount / jobsToProcess.length) * 100);
                
                io.emit('progressUpdate', {
                    completed: completedCount,
                    total: jobsToProcess.length, 
                    percent: percent
                });
                
                logger.debug(`진행 상태: ${completedCount}/${jobsToProcess.length} (${percent}%)`);
                }
            });
          
          // 현재 배치의 모든 결과 수집
          const batchResults = await Promise.all(batchPromises);
          
          // 결과 및 오류 분류
          batchResults.forEach(result => {
            if (result && result.success) {
              results.push(result.data);
            } else if (result) {
              errors.push(result);
            }
          });
          
          // 다음 배치 전 지연 (서버 부하 방지)
          if (i + concurrency < jobsToProcess.length) {
            await randomDelay(1, 2);
          }
        }
        
        await browser.close();
        logger.debug('브라우저 세션 종료됨');
      }
      
      // 크롤링이 모두 완료된 후 한 번에 데이터 저장
      logger.debug(`크롤링 완료: ${customersToSave.length}개의 유효한 고객 정보 수집됨`);
      logger.debug('일괄 저장 작업 시작...');
      
      // Sequelize 트랜잭션 생성
      const t = await sequelize.transaction();
      let customersWithoutContacts = [];

      try {
        // 저장된 고객 정보 ID 추적
        const savedCustomerIds = [];
        
        // 한 번에 모든 고객 정보 저장
        for (const item of customersToSave) {
          if (item.type === 'update') {
            // 기존 고객 정보 업데이트
            await CustomerInfo.update(
              {
                title: item.customer.title,
                company_name: item.customer.company_name,
                address: item.customer.address,
                source_filter: item.customer.source_filter
              },
              {
                where: { id: item.customer.id },
                transaction: t
              }
            );
            
            let contact = await ContactInfo.findOne({
              where: {
                phone_number: item.contact.phone_number,
                contact_person: item.contact.contact_person
              },
              transaction: t
            });
            
            if (!contact) {
              contact = await ContactInfo.create(
                {
                  phone_number: item.contact.phone_number,
                  contact_person: item.contact.contact_person
                },
                { transaction: t }
              );
            }
            
            const exists = await sequelize.models.CustomerContactMap.findOne({
              where: {
                customer_id: item.customer.id,
                contact_id: contact.id
              },
              transaction: t
            });
            
            if (!exists) {
              await sequelize.models.CustomerContactMap.create({
                customer_id: item.customer.id,
                contact_id: contact.id
              }, { transaction: t });
            }
            
            savedCustomerIds.push(item.customer.id);
            
          } else if (item.type === 'create') {
            // 신규 고객 정보 생성
            const newCustomer = await CustomerInfo.create(
              {
                posting_id: item.customer.posting_id,
                title: item.customer.title,
                company_name: item.customer.company_name,
                address: item.customer.address,
                source_filter: item.customer.source_filter
              },
              { transaction: t }
            );
            
            let contact = await ContactInfo.findOne({
              where: {
                phone_number: item.contact.phone_number,
                contact_person: item.contact.contact_person
              },
              transaction: t
            });
            
            if (!contact) {
              contact = await ContactInfo.create(
                {
                  phone_number: item.contact.phone_number,
                  contact_person: item.contact.contact_person
                },
                { transaction: t }
              );
            }
            
            const exists = await sequelize.models.CustomerContactMap.findOne({
              where: {
                customer_id: newCustomer.id,
                contact_id: contact.id
              },
              transaction: t
            });
            
            if (!exists) {
              await sequelize.models.CustomerContactMap.create({
                customer_id: newCustomer.id,
                contact_id: contact.id
              }, { transaction: t });
            }
            
            savedCustomerIds.push(newCustomer.id);
          }
        }
        
        // 연락처가 없는 고객 데이터 정리 작업 추가
        logger.debug('연락처가 없는 고객 데이터 정리 작업 시작');
        
        const customersWithoutContacts = await CustomerInfo.findAll({
          where: sequelize.literal('NOT EXISTS (SELECT 1 FROM customer_contact_map WHERE customer_contact_map.customer_id = CustomerInfo.id)'),
          transaction: t
        });
        
        if (customersWithoutContacts.length > 0) {
          logger.debug(`연락처 없는 고객 데이터 ${customersWithoutContacts.length}개 발견, 삭제 시작`);
          
          // 연락처 없는 고객 정보 삭제
          const customerIds = customersWithoutContacts.map(c => c.id);
          const deletedCount = await CustomerInfo.destroy({
            where: {
              id: customerIds
            },
            transaction: t
          });
          
          logger.debug(`연락처 없는 고객 데이터 ${deletedCount}개 삭제 완료`);
        } else {
          logger.debug('연락처 없는 고객 데이터가 없습니다.');
        }
        
        // 모든 작업이 성공적으로 완료되면 트랜잭션 커밋
        await t.commit();
        logger.debug(`DB 저장 완료: ${savedCustomerIds.length}개 고객 정보 저장 성공`);
        
        // 트랜잭션 완료 후 네이버 플레이스 URL 비동기 처리 시작
        if (savedCustomerIds.length > 0) {
          logger.debug(`저장된 ${savedCustomerIds.length}개 고객의 네이버 플레이스 URL 처리 시작`);
          
          // 비동기로 처리하되 결과를 기다리지 않음 (응답 지연 방지)
          batchProcessNaverPlaceUrls(savedCustomerIds)
            .then(results => {
              logger.debug(`네이버 플레이스 URL 처리 결과: ${JSON.stringify(results)}`);
            })
            .catch(err => {
              logger.error(`네이버 플레이스 URL 처리 중 오류: ${err.message}`);
            });
        }
        
      } catch (dbError) {
        // 오류 발생 시 트랜잭션 롤백
        await t.rollback();
        logger.error(`DB 저장 중 오류 발생, 모든 변경사항 롤백됨: ${dbError.message}`);
        
        return sendError(res, 500, `데이터 저장 중 오류가 발생했습니다: ${dbError.message}`);
      }
      
      // 필터링 된 항목 수 계산
      const filteredCount = results.filter(r => r.filtered).length;
      // 성공적으로 저장된 항목 수 계산
      const savedCount = results.filter(r => !r.filtered && !r.error).length;

      // 최종 진행 상태 업데이트 (100% 완료)
      io.emit('progressUpdate', {
          completed: jobsToProcess.length,
          total: jobsToProcess.length,
          percent: 100
      });
      
      return sendSuccess(res, {
          totalRequested: businesses.length,
          totalProcessed: jobsToProcess.length,
          savedCount: savedCount,
          filteredCount: filteredCount,
          errorCount: errors.length,
          cleanedCount: customersWithoutContacts.length, // 정리된 데이터 수 추가
          data: results.filter(r => !r.filtered), // 필터링 되지 않은 결과만 반환
          errors: errors.length > 0 ? errors : undefined
      });
        
    } catch (error) {
      // 오류 발생 시에도 진행 상태 업데이트
      io.emit('progressUpdate', {
        completed: 0,
        total: businesses.length,
        percent: 0,
        error: error.message
      });
      
      return sendError(res, 500, error.message);
    }
  };

  export const getCustomersWithContacts = async (req, res) => {
    try {
      const query = req.query;
      const data = await handleDbOperation(async () => {
        return await albamonService.getCustomersWithContacts(query);
      }, "고객 연락처 조회");
      
      return sendSuccess(res, data);
    } catch (error) {
      return sendError(res, 500, error.message);
    }
  };

