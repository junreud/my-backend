import cron from 'node-cron';
import { crawlAllKeywordsBasic } from './crawler/basicCrawlerService.js';
import { createLogger } from '../lib/logger.js';
import CrawlJob from '../models/CrawlJob.js';
import { autoCrawlQueue } from './crawler/keywordQueue.js'; // 큐 임포트

const logger = createLogger('SchedulerService');

let jobState = {
  isBasicCrawling: false,
  isDetailCrawling: false,
  currentJobId: null,
  startDate: null
};

export async function startCrawlingJob() {
  try {
    if (jobState.isBasicCrawling || jobState.isDetailCrawling) {
      logger.info('[INFO] 이미 크롤링 작업이 진행 중입니다.');
      return;
    }

    jobState.startDate = new Date();
    
    const job = await CrawlJob.create({
      start_date: jobState.startDate,
      status: 'basic_crawling',
      is_completed: false
    });
    
    jobState.currentJobId = job.id;
    jobState.isBasicCrawling = true;
    
    logger.info(`[INFO] 일일 크롤링 작업 시작 (작업 ID: ${job.id}, 날짜: ${jobState.startDate.toISOString()})`);
    
    await crawlAllKeywordsBasic(jobState.startDate, job.id);
    
    jobState.isBasicCrawling = false;
    jobState.isDetailCrawling = true;
    
    await CrawlJob.update(
      { status: 'detail_crawling' },
      { where: { id: jobState.currentJobId } }
    );
    
    logger.info(`[INFO] 기본 크롤링 완료, 자동 상세 크롤링 큐에 작업 추가 (작업 ID: ${jobState.currentJobId})`);
    
    // 자동 크롤링 큐에 작업 추가
    await autoCrawlQueue.add({}, { priority: 2 }); // 우선순위 낮게 설정
    
    jobState.isDetailCrawling = false;
    
    await CrawlJob.update(
      { 
        status: 'completed', 
        is_completed: true,
        end_date: new Date()
      },
      { where: { id: jobState.currentJobId } }
    );
    
    logger.info(`[INFO] 일일 크롤링 작업 완료 (작업 ID: ${jobState.currentJobId})`);
    jobState.currentJobId = null;
    jobState.startDate = null;
    
  } catch (error) {
    logger.error(`[ERROR] 크롤링 작업 중 오류 발생: ${error.message}`);
    
    if (jobState.currentJobId) {
      await CrawlJob.update(
        { 
          status: 'failed', 
          error_message: error.message,
          end_date: new Date()
        },
        { where: { id: jobState.currentJobId } }
      );
    }
    
    jobState.isBasicCrawling = false;
    jobState.isDetailCrawling = false;
  }
}

export function startScheduler() {
  cron.schedule('0 14 * * *', async () => {
    logger.info('[INFO] 정기 크롤링 작업 시작 시간 (14:00)');
    await startCrawlingJob();
  });
  
  logger.info('[INFO] 크롤링 스케줄러가 시작되었습니다. 매일 14:00에 실행됩니다.');
}

export async function startManualCrawling() {
  logger.info('[INFO] 수동 크롤링 작업 시작');
  await startCrawlingJob();
}
