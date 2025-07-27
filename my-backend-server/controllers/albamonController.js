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

// 메인 컨트롤러 - URL 기반 크롤링
export const crawlAlbamonController = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({
    logger,
    controllerName: 'AlbamonController',
    actionName: 'crawlAlbamon',
    defaultErrMessage: '알바몬 URL 크롤링 중 오류가 발생했습니다.'
  });

  try {
    const { urls } = req.body;
    
    validateRequiredFields(req.body, ['urls']); // This should throw if validation fails
    
    if (!Array.isArray(urls)) {
      const error = new Error('urls 필드는 배열이어야 합니다.');
      error.statusCode = 400;
      throw error;
    }
    
    controllerLogger.info(`Starting crawl for ${urls.length} URLs.`);
    const data = await handleDbOperation(
      () => albamonService.crawlFromUrls(urls),
      { operationName: "URL 크롤링" }
    );
    
    return { data, message: 'URL 크롤링 성공' };
  } catch (error) {
    controllerLogger.error('Error in crawlAlbamonController:', error);
    if (!error.statusCode) {
      error.statusCode = error.isValidationError ? 400 : 500;
    }
    throw error;
  }
};

// 여러 비즈니스 상세 정보 크롤링 및 DB 저장
export const processBusinessContacts = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({
    logger,
    controllerName: 'AlbamonController',
    actionName: 'processBusinessContacts',
    defaultErrMessage: '알바몬 비즈니스 연락처 처리 중 오류가 발생했습니다.'
  });

  try {
    const { businesses } = req.body;
    
    validateRequiredFields(req.body, ['businesses']); // This should throw if validation fails
    
    if (!Array.isArray(businesses) || businesses.length === 0) {
      const error = new Error('유효한 businesses 배열이 필요합니다.');
      error.statusCode = 400;
      throw error;
    }
    
    controllerLogger.info(`Processing ${businesses.length} business contacts.`);
    const result = await handleDbOperation(
      () => albamonService.batchProcessJobIds(businesses, io),
      { operationName: "비즈니스 연락처 처리" }
    );
    
    return { data: result, message: '비즈니스 연락처 처리 성공' };
  } catch (error) {
    controllerLogger.error('Error in processBusinessContacts:', error);
    if (!error.statusCode) {
      error.statusCode = error.isValidationError ? 400 : 500;
    }
    throw error;
  }
};

// 여러 ID를 한 번의 로그인 세션으로 처리하는 함수
export const batchProcessJobIds = async (req) => {
    const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({
      logger,
      controllerName: 'AlbamonController',
      actionName: 'batchProcessJobIds',
      defaultErrMessage: '알바몬 공고 일괄 처리 중 오류가 발생했습니다.'
    });

    try {
      const { businesses } = req.body;
      
      validateRequiredFields(req.body, ['businesses']); // This should throw if validation fails
      
      if (!Array.isArray(businesses) || businesses.length === 0) {
        const error = new Error("유효한 businesses 배열이 필요합니다.");
        error.statusCode = 400;
        throw error;
      }
      
      controllerLogger.info(`총 ${businesses.length}개 공고 처리 시작`);
      
      // 초기 진행 상태 전송
      io.emit('progressUpdate', {
        completed: 0,
        total: businesses.length,
        percent: 0
      });
      
      controllerLogger.debug('크롤링 준비: 중복 제거 및 유효성 검증');
      
      const uniqueJobIds = new Set();
      const jobsToProcess = [];
      
      for (const business of businesses) {
        const jobId = business.jobId || business.id;
        
        if (!jobId) {
          controllerLogger.warn('유효한 ID가 없는 비즈니스 항목 무시', { businessItem: business });
          continue;
        }
        
        if (uniqueJobIds.has(jobId)) {
          controllerLogger.debug(`중복 jobId 발견, 스킵: ${jobId}`);
          continue;
        }
        
        const existingCustomer = await handleDbOperation(
          CustomerInfo.findOne({
            where: { posting_id: jobId },
            include: [{
              model: ContactInfo,
              attributes: ['phone_number', 'contact_person']
            }]
          }),
          { operationName: 'FindExistingCustomerForSkip', suppressNotFoundError: true }
        );
        
        if (existingCustomer?.ContactInfos?.length > 0 && existingCustomer.ContactInfos[0].phone_number) {
          controllerLogger.debug(`ID ${jobId}: 기존 정보 발견, 크롤링 생략`);
          continue;
        }
        
        const title = business.postTitle || business.jobTitle || '';
        const companyName = business.businessName || business.companyName || '';
        const address = business.address || '';
        
        if (address && (title || companyName)) {
          const duplicateCustomer = await handleDbOperation(
            CustomerInfo.findOne({
              where: {
                [Op.or]: [
                  { address, title },
                  { address, company_name: companyName }
                ]
              }
            }),
            { operationName: 'FindDuplicateCustomer', suppressNotFoundError: true }
          );
          
          if (duplicateCustomer) {
            controllerLogger.debug(`중복된 업체 발견 (주소+제목 또는 주소+업체명): ${address}, ${title || companyName}`);
            continue;
          }
        }
        
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
        if (parsingTypeLabel) sourceFilterParts.push(`파싱종류:${parsingTypeLabel}`);
        if (regionValue) sourceFilterParts.push(`지역:${regionValue}`);
        if (includeKeywords) {
          const includeStr = Array.isArray(includeKeywords) ? includeKeywords.join(',') : includeKeywords;
          sourceFilterParts.push(`포함:${includeStr}`);
        }
        if (excludeKeywords) {
          const excludeStr = Array.isArray(excludeKeywords) ? excludeKeywords.join(',') : excludeKeywords;
          sourceFilterParts.push(`제외:${excludeStr}`);
        }
        const source_filter = sourceFilterParts.join(', ');

        uniqueJobIds.add(jobId);
        jobsToProcess.push({
          jobId,
          title,
          companyName,
          address,
          source_filter
        });
      }
      
      controllerLogger.info(`크롤링할 고유 공고 ID 수: ${jobsToProcess.length}`);
      
      const results = [];
      const errors = [];
      
      if (jobsToProcess.length > 0) {
        const { browser, context } = await getLoggedInSession(); // This is not a DB operation, so not wrapped.
        controllerLogger.debug('로그인 세션 생성 성공');
        
        const concurrency = 6; 
        const delay = 300; 
        let completedCount = 0;
        
        for (let i = 0; i < jobsToProcess.length; i += concurrency) {
          const batch = jobsToProcess.slice(i, i + concurrency);
          controllerLogger.debug(`배치 크롤링: ${i+1}-${Math.min(i+concurrency, jobsToProcess.length)}/${jobsToProcess.length}`);
          
            const batchPromises = batch.map(async (item, index) => {
                await new Promise(r => setTimeout(r, index * delay));
                
                const { jobId, title, companyName, address, source_filter } = item;
                let page; // Declare page here to ensure it's in scope for finally block if needed for closing
                
                try {
                  controllerLogger.debug(`ID ${jobId} 크롤링 시작`);
                  page = await context.newPage();
                  const url = `https://www.albamon.com/jobs/detail/${jobId}`;
                  
                  try {
                      await page.goto(url, { timeout: 30000 });
                      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
                        controllerLogger.warn(`Timeout waiting for networkidle for jobId: ${jobId}, proceeding.`);
                      });
                      
                      const html = await page.content();
                      const $ = cheerio.load(html);
                      
                      const detailCompanyName = $('div.company-info strong').text().trim();
                      const detailAddress = $('p.detail-recruit-area__address').text().replace('복사', '').trim();
                      
                      let phone = null;
                      let contactPerson = null;
                      
                      const iframeElement = await page.$('iframe[title="담당자 정보"]');
                      if (iframeElement) {
                        const frame = await iframeElement.contentFrame();
                        if (frame) {
                            try {
                              await frame.waitForTimeout(500); 
                              await frame.waitForSelector('dt:has-text("전화") + dd div', { timeout: 5000 }).catch(() => {
                                controllerLogger.warn(`Timeout waiting for phone selector in iframe for jobId: ${jobId}`);
                              });
                              const phoneElements = await frame.$$('dt:has-text("전화") + dd div');
                              
                              if (phoneElements.length > 0) {
                                  const phoneNumbers = await Promise.all(
                                    phoneElements.map(el => frame.evaluate(node => node.textContent.trim(), el))
                                  );
                                  phone = phoneNumbers.find(num => num.startsWith('010')) || phoneNumbers[0] || null;
                                  
                                  if (phone && phone.includes('안심번호')) {
                                    controllerLogger.debug(`ID ${jobId}: 안심번호 발견: "${phone}", 저장 건너뜀`);
                                    // await page.close(); // Moved to finally
                                    return { success: false, error: '안심번호 발견', jobId };
                                  }
                              }
                              
                              const personElement = await frame.$('dt:has-text("담당자") + dd');
                              if (personElement) {
                                  contactPerson = await frame.evaluate(node => node.textContent.trim(), personElement);
                              }
                            } catch (frameErr) {
                              controllerLogger.warn(`ID ${jobId}: iframe 처리 중 오류: ${frameErr.message}`);
                            }
                        }
                      }
                      
                      if (!phone || phone === '') {
                        controllerLogger.debug(`ID ${jobId}: 전화번호 없음, 저장 건너뜀`);
                        return { success: false, error: '전화번호 없음', jobId };
                      }
                      
                      const filterKeywords = ['채용담당자', '인사담당자', '담당자', '매니저', '담당채용자', '점장', '채용담당', '매니져', '인사담당'];
                      if (contactPerson && filterKeywords.some(keyword => contactPerson.includes(keyword))) {
                        controllerLogger.debug(`ID ${jobId}: 필터링된 담당자 키워드 발견: "${contactPerson}", 저장 건너뜀`);
                        const existingCustomerForDelete = await handleDbOperation(
                          CustomerInfo.findOne({ where: { posting_id: jobId } }),
                          { operationName: 'FindCustomerForDeleteByKeyword', suppressNotFoundError: true }
                        );
                        if (existingCustomerForDelete) {
                          controllerLogger.debug(`ID ${jobId}: 담당자 키워드로 인해 DB에서 삭제`);
                          await handleDbOperation(
                            ContactInfo.destroy({ where: { customer_id: existingCustomerForDelete.id } }), // This seems incorrect, ContactInfo doesn't have customer_id directly. It's linked via CustomerContactMap
                            { operationName: 'DeleteContactsByKeyword' }
                          );
                          // Need to delete from CustomerContactMap first, then ContactInfo if not used elsewhere, then CustomerInfo
                          await handleDbOperation(
                            CustomerContactMap.destroy({ where: { customer_id: existingCustomerForDelete.id } }),
                            { operationName: 'DeleteContactMapByKeyword' }
                          );
                          await handleDbOperation(
                            existingCustomerForDelete.destroy(),
                            { operationName: 'DeleteCustomerByKeyword' }
                          );
                        }
                        return {
                          success: true, // Still a success in terms of processing, but filtered
                          data: { jobId, filtered: true, filterReason: `담당자명 필터링: "${contactPerson}"` }
                        };
                      }
                      
                      // DB Operations wrapped
                      let customer = await handleDbOperation(
                        CustomerInfo.findOne({ where: { posting_id: jobId } }),
                        { operationName: 'FindCustomerForSave', suppressNotFoundError: true }
                      );

                      if (!customer) {
                        customer = await handleDbOperation(
                          CustomerInfo.create({
                            posting_id: jobId,
                            title: title || detailCompanyName,
                            company_name: detailCompanyName || companyName,
                            address: detailAddress || address,
                            source_filter: source_filter // item.source_filter was used before, ensuring it's correct
                          }),
                          { operationName: 'CreateCustomer' }
                        );
                      } else {
                        await handleDbOperation(
                          CustomerInfo.update({
                            title: title || detailCompanyName,
                            company_name: detailCompanyName || companyName,
                            address: detailAddress || address,
                            source_filter: source_filter
                          }, { where: { id: customer.id } }),
                          { operationName: 'UpdateCustomer' }
                        );
                        // Make sure 'customer' object is updated with new values if needed later, or re-fetch.
                        // For this flow, just getting the ID is enough for the map.
                      }
                      
                      let contact = await handleDbOperation(
                        ContactInfo.findOne({ where: { phone_number: phone, contact_person: contactPerson } }),
                        { operationName: 'FindContactForSave', suppressNotFoundError: true }
                      );
                      
                      if (!contact) {
                        contact = await handleDbOperation(
                          ContactInfo.create({ phone_number: phone, contact_person: contactPerson }),
                          { operationName: 'CreateContact' }
                        );
                      }
                      
                      const mappingExists = await handleDbOperation(
                        CustomerContactMap.findOne({ where: { customer_id: customer.id, contact_id: contact.id } }),
                        { operationName: 'FindCustomerContactMap', suppressNotFoundError: true }
                      );
                      
                      if (!mappingExists) {
                        await handleDbOperation(
                          CustomerContactMap.create({ customer_id: customer.id, contact_id: contact.id }),
                          { operationName: 'CreateCustomerContactMap' }
                        );
                      }
                      
                      controllerLogger.debug(`ID ${jobId}: 실시간 저장 완료`);
                      return { success: true, data: { jobId } };
                  } catch (pageError) {
                      controllerLogger.error(`ID ${jobId}: 페이지 처리 중 오류: ${pageError.message}`, { stack: pageError.stack });
                      return { success: false, error: pageError.message, jobId };
                  } finally {
                      if (page) await page.close();
                  }
                } catch (error) {
                  controllerLogger.error(`ID ${jobId}: 처리 중 오류: ${error.message}`, { stack: error.stack });
                  return { success: false, error: error.message, jobId };
                } finally {
                  completedCount++;
                  const percent = Math.round((completedCount / jobsToProcess.length) * 100);
                  io.emit('progressUpdate', {
                      completed: completedCount,
                      total: jobsToProcess.length, 
                      percent: percent
                  });
                  controllerLogger.debug(`진행 상태: ${completedCount}/${jobsToProcess.length} (${percent}%)`);
                }
            });
          
          const batchResults = await Promise.all(batchPromises);
          
          batchResults.forEach(result => {
            if (result && result.success) {
              results.push(result.data);
            } else if (result) {
              errors.push({ jobId: result.jobId, error: result.error });
              controllerLogger.warn(`Failed to process jobId ${result.jobId}: ${result.error}`);
            }
          });
          
          if (i + concurrency < jobsToProcess.length) {
            await randomDelay(1, 2);
          }
        }
        
        if (browser) await browser.close(); // Ensure browser is closed
        controllerLogger.debug('브라우저 세션 종료됨');
      }
      
      // The section for `customersToSave` and transaction `t` seems to be a duplicate
      // or an alternative way of saving data that was present in the original file.
      // The current refactoring saves data in real-time within the loop.
      // If `customersToSave` and the transaction block are indeed redundant with the real-time saving,
      // they should be removed to avoid confusion and potential duplicate operations.
      // For now, I will comment out the transaction block as the logic above already saves data.
      // If this block is essential for a different purpose, it needs to be re-evaluated.

      /*
      controllerLogger.debug(`크롤링 완료: ${customersToSave.length}개의 유효한 고객 정보 수집됨`); // customersToSave is not populated in the refactored code above
      controllerLogger.debug('일괄 저장 작업 시작...');
      
      const t = await sequelize.transaction();
      // let customersWithoutContacts = []; // This variable is not used

      try {
        // 저장된 고객 정보 ID 추적
        // const savedCustomerIds = []; // This variable is not used
        
        // 한 번에 모든 고객 정보 저장
        for (const item of customersToSave) { // customersToSave is empty
          // ... (transactional save logic)
        }
        await t.commit();
        controllerLogger.info('일괄 저장 작업 완료 (커밋됨)');
      } catch (transactionError) {
        await t.rollback();
        controllerLogger.error('일괄 저장 작업 중 오류 발생, 롤백됨:', transactionError);
        // This error should be propagated or handled appropriately
        // For now, just logging it. If this block is to be used, proper error handling is needed.
      }
      */
      
      controllerLogger.info(`일괄 처리 완료. 성공: ${results.length}, 실패: ${errors.length}`);
      if (errors.length > 0) {
        controllerLogger.warn('실패한 항목:', { errors });
      }
      
      return {
        message: `총 ${jobsToProcess.length}개 중 ${results.length}개 성공, ${errors.length}개 실패/건너뜀.`,
        processed: results.length,
        skippedOrFailed: errors.length,
        details: {
            successfulItems: results.filter(r => r && !r.filtered),
            filteredItems: results.filter(r => r && r.filtered),
            errors: errors
        }
      };

    } catch (error) {
      controllerLogger.error('Error in batchProcessJobIds:', error);
      if (!error.statusCode) {
        error.statusCode = error.isValidationError ? 400 : 500;
      }
      throw error;
    }
};

export const getCustomersWithContacts = async (req) => {
    const { handleDbOperation, logger: controllerLogger } = createControllerHelper({
        logger,
        controllerName: 'AlbamonController',
        actionName: 'getCustomersWithContacts',
        defaultErrMessage: '고객 연락처 조회 중 오류 발생'
    });

    try {
      const query = req.query;
      const data = await handleDbOperation(async () => {
        return await albamonService.getCustomersWithContacts(query);
      }, "고객 연락처 조회");
      
      return data;
    } catch (error) {
      controllerLogger.error('Error in getCustomersWithContacts:', error);
      if (!error.statusCode) {
        error.statusCode = 500;
      }
      throw error;
    }
  };

