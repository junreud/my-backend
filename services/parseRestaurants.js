// 예시: parseRestaurants.js
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/** 최대 크롤링 항목 수 */
const MAX_ITEMS = 300;

/** 
 * 주어진 페이지에서 최대 300개 항목을 파싱:
 *  - placeId
 *  - 이름(span.TYaxT)
 *  - 카테고리(span.KCMnt)
 *  - 블로그리뷰: a[href*="review/ugc"]
 *  - 방문자(영수증)리뷰: a[href*="review/visitor"]
 */
async function parseRestaurants(page) {
  // 1) 'li.UEzoS' 항목들을 전부 수집 + slice(0..300)
  //    $$eval: 페이지 내부에서 DOM을 순회하여, 필요한 정보들을 Object로 만들어 반환
  const items = await page.$$eval('li.UEzoS', (els, maxCount) => {
    // 함수 내부: 브라우저 DOM 환경
    const results = [];
    for (let i = 0; i < els.length; i++) {
      if (results.length >= maxCount) break;

      const el = els[i];

      // (A) 메인 링크 (예: <a href="/restaurant/30924288?entry=pll"...>)
      const anchor = el.querySelector('a.tzwk0'); 
      // 참고: 실제 구조상 a.tzwk0 가 아닐 수도 있으니, 구조에 맞게 수정
      if (!anchor) continue;

      const linkHref = anchor.getAttribute('href') || '';
      // href 예: "/restaurant/30924288?entry=pll"
      // placeId 추출 (정규식 or substring)
      let placeId = '';
      const match = linkHref.match(/\/restaurant\/(\d+)/);
      if (match && match[1]) {
        placeId = match[1];
      }

      // (B) 가게 이름 (span.TYaxT)
      const nameEl = el.querySelector('span.TYaxT');
      const name = nameEl ? nameEl.innerText.trim() : '';

      // (C) 카테고리(업종) (span.KCMnt)
      const catEl = el.querySelector('span.KCMnt');
      const category = catEl ? catEl.innerText.trim() : '';

      // (D) PXMot 내부 링크로부터 리뷰 수
      //  - a[href*="/review/visitor"] → "방문자 리뷰 282"
      //  - a[href*="/review/ugc"] → "블로그 리뷰 201"
      let blogReviewCount = 0;
      let receiptReviewCount = 0;

      const pxMotEl = el.querySelector('.PXMot');
      if (pxMotEl) {
        // 영수증(방문자) 리뷰
        const visitorA = pxMotEl.querySelector('a[href*="review/visitor"]');
        if (visitorA) {
          // 예: innerText = "방문자 리뷰 282"
          const text = visitorA.innerText || '';
          const m = text.match(/\d+/);
          if (m) receiptReviewCount = parseInt(m[0], 10);
        }
        // 블로그 리뷰
        const blogA = pxMotEl.querySelector('a[href*="review/ugc"]');
        if (blogA) {
          // 예: innerText = "블로그 리뷰 201"
          const text = blogA.innerText || '';
          const m = text.match(/\d+/);
          if (m) blogReviewCount = parseInt(m[0], 10);
        }
      }

      results.push({
        placeId,
        name,
        category,
        blogReviewCount,
        receiptReviewCount
      });
    }
    return results;
  }, MAX_ITEMS);

  return items;
}


async function main() {
  // 브라우저 열기
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  // 테스트할 URL (임의 예시)
  const url = 'https://m.place.naver.com/restaurant/list?...';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  
  // (선택) 무한 스크롤 or waitForSelector('li.UEzoS') 등
  // ...

  // 파싱
  const restaurants = await parseRestaurants(page);

  console.log(`총 파싱 개수: ${restaurants.length}`);
  restaurants.forEach(r => {
    console.log(
      `placeId=${r.placeId}, name=${r.name}, cat=${r.category}, ` +
      `블로그리뷰=${r.blogReviewCount}, 영수증리뷰=${r.receiptReviewCount}`
    );
  });

  // 파일 저장 (예: JSON)
  fs.writeFileSync(
    path.join(process.cwd(), 'parsed_restaurants.json'),
    JSON.stringify(restaurants, null, 2),
    'utf8'
  );

  await browser.close();
}

main().catch(err => console.error(err));
