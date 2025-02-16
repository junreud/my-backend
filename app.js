const express = require('express');
const app = express();
const PORT = 3001;  // 사용할 포트 번호
app.get('/', (req, res) => {
  res.send('Hello, World!');  // 기본 응답
});
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
