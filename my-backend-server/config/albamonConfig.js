import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { createLogger } from '../lib/logger.js';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { promisify } from 'util';

// .env 파일 로드
dotenv.config();

const execFileAsync = promisify(execFile);
const logger = createLogger('AlbamonCrawlerConfig');

/**
 * 자동으로 알바몬 로그인 후 쿠키 저장
 */
export async function saveAlbamonCookies() {
  const { browser, context, page, cookies, ua } = await getLoggedInSession();
  const cookieFilePath = path.join(process.cwd(), 'albamonCookies.json');
  fs.writeFileSync(cookieFilePath, JSON.stringify({ ua, cookies }, null, 2), 'utf-8');
  logger.info(`쿠키 및 UA 저장 완료: ${cookieFilePath}`);
  await browser.close();
}

/**
 * 로그인하고 브라우저 세션 반환
 */
export async function getLoggedInSession() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    logger.info('알바몬 로그인 페이지 접속 중...');
    await page.goto('https://www.albamon.com/user-account/login?memberType=PERSONAL&redirect_url=', { timeout: 120000 });

    // ID와 비밀번호 입력
    logger.info('로그인 정보 입력 중...');
    await page.fill('#memberId', process.env.ALBAMON_ID);
    await page.fill('#memberPassword', process.env.ALBAMON_PASSWORD);

    // 로그인 버튼 클릭
    logger.info('로그인 시도 중...');
    await page.click('button[type="submit"].Button_primary__5usVQ');

    // 로그인 성공 확인
    await page.waitForSelector('input[placeholder="어떤 알바를 찾으세요?"]', { timeout: 30000 });
    logger.info('로그인 성공!');

    // 쿠키 저장
    const cookies = await context.cookies();
    const ua = await page.evaluate(() => navigator.userAgent);

    const cookieFilePath = path.join(process.cwd(), 'albamonCookies.json');
    fs.writeFileSync(cookieFilePath, JSON.stringify({ ua, cookies }, null, 2), 'utf-8');
    logger.info(`쿠키 및 UA 저장 완료`);

    // 브라우저 세션 반환
    return { browser, context, page, cookies, ua };
  } catch (error) {
    logger.error(`로그인 중 오류 발생: ${error.message}`);
    await browser.close();
    throw error;
  }
}

/**
 * 저장된 알바몬 쿠키와 UA 로드
 * @returns {{ua: string, cookieStr: string, cookies: Array}}
 */
export async function loadAlbamonUAandCookies() {
  try {
    const dataPath = path.join(process.cwd(), 'albamonCookies.json');

    // 쿠키 파일이 없으면 자동으로 생성
    if (!fs.existsSync(dataPath)) {
      logger.warn('알바몬 쿠키 파일이 존재하지 않습니다. 자동 로그인을 시도합니다.');
      await saveAlbamonCookies();
    } else {
      // 쿠키 유효성 검사
      const isValid = await checkAlbamonCookieValidity();
      if (!isValid) {
        logger.warn('알바몬 쿠키가 만료되었습니다. 자동 로그인으로 새로운 쿠키를 생성합니다.');
        await saveAlbamonCookies();
      }
    }

    // 새로 생성되거나 이미 존재하는 쿠키 로드
    const { ua, cookies } = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    logger.debug(`알바몬 쿠키 로드 성공`);
    return { ua, cookieStr, cookies }; // Include cookies in the return
  } catch (err) {
    logger.error(`알바몬 쿠키 로드 오류: ${err.message}`);
    
    // 쿠키 생성 중 오류가 발생하면 스크립트를 직접 실행 (마지막 시도)
    try {
      logger.info('외부 스크립트를 통한 쿠키 생성 시도...');
      await execFileAsync('node', ['scripts/albamonCookie.js']);
      
      // 스크립트 실행 후 쿠키 파일 확인
      const dataPath = path.join(process.cwd(), 'albamonCookies.json');
      if (fs.existsSync(dataPath)) {
        const { ua, cookies } = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        return { ua, cookieStr, cookies }; // Include cookies in the return
      }
    } catch (scriptError) {
      logger.error(`외부 스크립트 실행 오류: ${scriptError.message}`);
    }
    
    throw err; // 모든 시도가 실패하면 오류 발생
  }
}

/**
 * 쿠키 유효성 체크 함수
 * @returns {Promise<boolean>}
 */
export async function checkAlbamonCookieValidity() {
  try {
    const dataPath = path.join(process.cwd(), 'albamonCookies.json');
    
    if (!fs.existsSync(dataPath)) {
      return false;
    }
    
    const { ua, cookies } = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    // Playwright로 실제 로그인 상태 확인 (더 정확함)
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    
    // 쿠키 설정
    for (const cookie of cookies) {
      await context.addCookies([cookie]);
    }
    
    const page = await context.newPage();
    await page.goto('https://www.albamon.com/', { timeout: 30000 });
    
    // 로그인 상태 확인 (검색창 존재 여부)
    const isLoggedIn = await page.isVisible('input[placeholder="어떤 알바를 찾으세요?"]');
    
    await browser.close();
    return isLoggedIn;
  } catch (error) {
    logger.error(`쿠키 유효성 체크 중 오류: ${error.message}`);
    return false;
  }
}