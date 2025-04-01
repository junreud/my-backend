// deduplicatePlaceDetailResults.js
import { Sequelize } from 'sequelize';

// 1) DB 연결 정보
const sequelize = new Sequelize('mysql://jskim:Wnstjr5816!@localhost:3306/myapp', {
  logging: false, // SQL 로그 출력 여부
});

(async () => {
  try {
    console.log('=== 시작: place_detail_results 중복 제거 및 타임스탬프 업데이트 ===');

    // (A) 중복 제거:
    // place_id 기준으로 MIN(id)만 남기고, 나머지 행을 삭제하는 쿼리
    // (MySQL 문법 기준)
    await sequelize.query(`
      DELETE p
      FROM place_detail_results AS p
      LEFT JOIN (
        SELECT MIN(id) AS keep_id
        FROM place_detail_results
        GROUP BY place_id
      ) AS sub ON p.id = sub.keep_id
      WHERE sub.keep_id IS NULL
    `);

    console.log('[INFO] 중복된 place_id 레코드 삭제 완료.');

    // (B) 남은 행들의 created_at, updated_at 현재 시간으로 일괄 업데이트
    // (MySQL, MariaDB 기준 NOW() 사용. PostgreSQL이면 now() 또는 CURRENT_TIMESTAMP 등)
    await sequelize.query(`
      UPDATE place_detail_results
      SET created_at = NOW(),
          updated_at = NOW()
    `);

    console.log('[INFO] created_at, updated_at 현재 시각으로 일괄 업데이트 완료.');

    console.log('=== 완료 ===');
  } catch (err) {
    console.error('[ERROR]', err);
  } finally {
    // DB 연결 종료
    await sequelize.close();
  }
})();