// test/test.js
const { findCompetitorsWithReviews } = require('../services/competitorService');
  
  (async () => {
    const myCategory = '술집';
    const myX = 126.9815191; // 내 업체 x
    const myY = 37.4799575;  // 내 업체 y
  
    // 경쟁업체 찾기 + 블로그 리뷰 포함
    const results = await findCompetitorsWithReviews(myCategory, myX, myY);
  
    // 확인
    for (const comp of results) {
      console.log(`\n[경쟁업체: ${comp.name}] 주소: ${comp.address}`);
      console.log(`- 블로그 리뷰 수: ${comp.blogReviews.length}`);
      comp.blogReviews.forEach((rev, idx) => {
        console.log(`  ${idx + 1}) ${rev.title} (${rev.postDate})`);
      });
    }
  })();
  