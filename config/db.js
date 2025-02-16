// **연결 풀(pool)**을 생성하여 재사용하는 예입니다. mysql2 패키지는 콜백뿐 아니라 Promise 기반 인터페이스도 제공하므로 async/await 문법으로 쿼리를 실행할 수 있습니다​
// BLOG.LOGROCKET.COM
// . 예를 들어, 다른 모듈에서 위 pool을 불러와 다음과 같이 쿼리를 실행합니다:
// ! 
// ?
// TODO 
const mysql = require('mysql2/promise');
// MySQL 연결 설정 (앞서 생성한 사용자 정보 사용)
const pool = mysql.createPool({
  host: process.env.DB_HOST,        // .env 파일에 DB_HOST=localhost 같은 식으로 작성
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,    // 최대 동시 연결 수
  queueLimit: 0
});
module.exports = pool;
 