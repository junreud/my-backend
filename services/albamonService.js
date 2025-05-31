import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { loadAlbamonUAandCookies, getLoggedInSession } from '../config/albamonConfig.js';
import { randomDelay } from '../config/crawler.js';
import { CustomerInfo, ContactInfo, CustomerContactMap } from '../models/index.js';

// 크롤링하여 공고 목록을 가져오는 서비스 함수
export async function crawlFromUrls(urls) {
  const size = 50;
  const results = [];
  const { ua, cookieStr } = await loadAlbamonUAandCookies();

  for (const originalUrl of urls) {
    const url = cleanUrl(originalUrl);
    const isSearch = url.includes('total-search');
    const isArea = url.includes('/jobs/');
    if (!isSearch && !isArea) continue;

    // 초기 요청
    const res0 = await fetchWithTimeout(url, { method: 'GET', headers: getCommonHeaders(cookieStr, ua) });
    if (!res0.ok) continue;
    const html0 = await res0.text();
    const $ = cheerio.load(html0);

    const totalCount = extractTotalCount($, isSearch ? 'search' : 'area');
    const totalPages = Math.ceil(totalCount / size);

    for (let page = 1; page <= totalPages; page++) {
      const u = new URL(url);
      u.searchParams.set('page', page);
      u.searchParams.set('size', size);

      const resPage = await fetchWithTimeout(u.toString(), { method: 'GET', headers: getCommonHeaders(cookieStr, ua) });
      if (!resPage.ok) continue;
      const htmlPage = await resPage.text();
      const $$ = cheerio.load(htmlPage);

      const parsed = isSearch ? parseSearchPage($$) : parseAreaPage($$);
      results.push(...parsed);

      if (page < totalPages) await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 중복 제거
  const unique = [];
  const keys = new Set();
  for (const item of results) {
    const k1 = `${item.address}|${item.companyName}`.toLowerCase();
    const k2 = `${item.address}|${item.jobTitle}`.toLowerCase();
    if (!keys.has(k1) && !keys.has(k2)) {
      unique.push(item);
      keys.add(k1);
      keys.add(k2);
    }
  }
  return unique;
}

// 여러 ID를 이용해 상세 연락처 크롤링 & 저장하는 서비스 함수
export async function batchProcessJobIds(businesses, io) {
  const uniqueIds = new Set();
  const jobs = [];
  for (const b of businesses) {
    const id = b.jobId || b.id;
    if (!id || uniqueIds.has(id)) continue;
    uniqueIds.add(id);
    jobs.push({ jobId: id, ...b });
  }

  const { browser, context } = await getLoggedInSession();
  let completed = 0;
  const results = [];
  const errors = [];
  const concurrency = 6;

  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const promises = batch.map((item, idx) => (async () => {
      await new Promise(r => setTimeout(r, idx * 300));
      try {
        const page = await context.newPage();
        const url = `https://www.albamon.com/jobs/detail/${item.jobId}`;
        await page.goto(url);
        const html = await page.content();
        const $ = cheerio.load(html);
        // 상세 파싱 생략, DB 저장 로직을 필요에 맞게 추가
        results.push({ jobId: item.jobId });
        await page.close();
      } catch (e) {
        errors.push({ jobId: item.jobId, error: e.message });
      } finally {
        completed++;
        io.emit('progressUpdate', { completed, total: jobs.length, percent: Math.round((completed/jobs.length)*100) });
      }
    })());
    await Promise.all(promises);
    await randomDelay(1, 2);
  }
  await browser.close();
  return { results, errors };
}

// 고객 및 연락처 통합 데이터 조회 서비스
export async function getCustomersWithContacts(query) {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.pageSize) || 50;
  const offset = (page - 1) * limit;
  let order;
  if (query.sortBy === 'company') order = [['company_name','ASC']];
  else if (query.sortBy === 'address') order = [['address','ASC']];
  else order = [['created_at','DESC']];

  const where = {};
  if (query.search) {
    where[Op.or] = [
      { company_name: { [Op.like]: `%${query.search}%` }},
      { title: { [Op.like]: `%${query.search}%` }},
      { address: { [Op.like]: `%${query.search}%` }}
    ];
  }

  const { count, rows } = await CustomerInfo.findAndCountAll({
    where, limit, offset, distinct: true, order,
    include: [{ model: ContactInfo, through:{attributes:[]}, attributes:['id','phone_number','contact_person','favorite','blacklist','friend_add_status'] }]
  });

  const data = rows.map(c => {
    const p = c.get({ plain: true });
    return {
      id: p.id,
      posting_id: p.posting_id,
      title: p.title,
      company_name: p.company_name,
      address: p.address || '',
      naverplace_url: p.naverplace_url || null,
      source_filter: p.source_filter || '',
      contacts: (p.ContactInfos||[]).map(ct => ({
        id: ct.id,
        phone_number: ct.phone_number,
        contact_person: ct.contact_person,
        favorite: ct.favorite,
        blacklist: ct.blacklist,
        friend_add_status: ct.friend_add_status
      }))
    };
  });

  return { total: count, page, limit, totalPages: Math.ceil(count/limit), data };
}
