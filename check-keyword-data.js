// 키워드 히스토리 데이터 확인용 스크립트
import sequelize from "./config/db.js";
import Keyword from "./models/Keyword.js";
import KeywordBasicCrawlResult from "./models/KeywordBasicCrawlResult.js";
import UserPlaceKeyword from "./models/UserPlaceKeyword.js";
import User from "./models/User.js";

async function checkKeywordData() {
  try {
    console.log("=== 키워드 데이터 조사 시작 ===");
    
    // 0. 사용자 목록 확인
    console.log("\n0. 데이터베이스 사용자 목록:");
    const users = await User.findAll({
      attributes: ['id', 'email', 'name']
    });
    
    users.forEach(user => {
      console.log(`  - ID: ${user.id}, Email: ${user.email}, Name: ${user.name}`);
    });
    
    // 1. 각 사용자의 키워드 목록 확인
    for (const user of users) {
      console.log(`\n1. 사용자 ${user.id}의 키워드 목록:`);
      const userKeywords = await UserPlaceKeyword.findAll({
        where: { user_id: user.id },
        include: [
          {
            model: Keyword,
            as: 'keyword',
            attributes: ['id', 'keyword']
          }
        ],
        limit: 5
      });
      
      userKeywords.forEach(uk => {
        console.log(`  - ID: ${uk.id}, KeywordId: ${uk.keyword_id}, Keyword: ${uk.keyword?.keyword}, PlaceId: ${uk.place_id}`);
      });
    }
    
    // 2. 키워드 754에 대한 크롤링 결과 확인
    console.log("\n2. 키워드 754 크롤링 결과:");
    const crawlResults754 = await KeywordBasicCrawlResult.findAll({
      where: { keyword_id: 754 },
      order: [["last_crawled_at", "DESC"]],
      limit: 5
    });
    
    console.log(`  총 ${crawlResults754.length}개의 결과`);
    crawlResults754.forEach(result => {
      console.log(`  - PlaceId: ${result.place_id}, Rank: ${result.search_rank}, Date: ${result.last_crawled_at}`);
    });
    
    // 3. placeId 1697483730과 keywordId 754 조합 확인
    console.log("\n3. PlaceId 1697483730 + KeywordId 754 조합:");
    const specificResults = await KeywordBasicCrawlResult.findAll({
      where: { 
        place_id: '1697483730',
        keyword_id: 754
      },
      order: [["last_crawled_at", "DESC"]]
    });
    
    console.log(`  총 ${specificResults.length}개의 결과`);
    specificResults.forEach(result => {
      console.log(`  - Rank: ${result.search_rank}, Date: ${result.last_crawled_at}, URL: ${result.place_url}`);
    });
    
  } catch (error) {
    console.error("데이터 조사 중 오류:", error);
  } finally {
    await sequelize.close();
  }
}

checkKeywordData();
