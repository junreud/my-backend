// keywordQueue.js
import Queue from 'bull';
import { crawlKeywordDetail } from './detailCrawlerService.js';

export const detailQueue = new Queue('detail-keyword-queue', {
  // redis connection options
  redis: {
    host: '127.0.0.1',
    port: 6379,
  }
});

// 워커(Worker): 큐에 job이 들어오면 처리
detailQueue.process(async (job) => {
  const { keywordId } = job.data;
  console.log(`[BULL] 디테일 크롤링 작업 시작 (keywordId=${keywordId})`);
  try {
    await crawlKeywordDetail(keywordId, 30);
    console.log(`[BULL] 디테일 크롤링 작업 종료 (keywordId=${keywordId})`);
  } catch (err) {
    console.error(`[BULL][ERROR] 디테일 크롤링 실패 (keywordId=${keywordId})`, err);
    throw err;
  }
});

// 에러/완료 이벤트 등 추가 가능
detailQueue.on('completed', (job) => {
  console.log(`[BULL] Job 완료: id=${job.id}, keywordId=${job.data.keywordId}`);
});
detailQueue.on('failed', (job, err) => {
  console.log(`[BULL][ERROR] Job 실패: id=${job.id}, keywordId=${job.data.keywordId}, error=${err}`);
});