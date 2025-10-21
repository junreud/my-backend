import sequelize from "../config/db.js"; // sequelize 인스턴스 import

(async () => {
  try {
    // QueryInterface 인스턴스 얻기
    const queryInterface = sequelize.getQueryInterface();

    // "users" 테이블의 스키마 정보 조회
    const tableDescription = await queryInterface.describeTable("users");

    // 결과 확인 (컬럼 이름, 데이터 타입, allowNull 여부 등)
    console.log(tableDescription);
  } catch (error) {
    console.error("Error describing table:", error);
  } finally {
    // 필요 시 연결 종료
    // await sequelize.close();
  }
})();
