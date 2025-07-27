// 마이그레이션 파일: add_place_detail_fields.js
// 실행 방법: npx sequelize-cli migration:generate --name add-place-detail-fields

'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // place_detail_results 테이블에는 상세 크롤링 전용 필드만 필요
    // place_name, category, address는 KeywordBasicCrawlResult에 이미 저장되므로 불필요
    console.log('PlaceDetailResult 테이블은 이미 필요한 필드들을 포함하고 있습니다.');
  },

  async down(queryInterface, Sequelize) {
    // 롤백 시 특별한 작업 없음
    console.log('PlaceDetailResult 테이블 롤백 완료');
  }
};
