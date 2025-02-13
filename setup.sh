#!/bin/bash

# Homebrew가 설치되어 있는지 확인
if ! command -v brew >/dev/null; then
  echo "Homebrew가 설치되어 있지 않습니다. 먼저 Homebrew를 설치해주세요."
  exit 1
fi

# Node.js가 설치되어 있는지 확인 후, 없으면 설치
if ! command -v node >/dev/null; then
  echo "Node.js를 설치합니다..."
  brew install node
fi

# npm 프로젝트 초기화 (-y 옵션은 기본값 사용)
echo "npm 프로젝트를 초기화합니다..."
npm init -y

# Express 설치
echo "Express를 설치합니다..."
npm install express

# 기본 서버 코드가 포함된 index.js 파일 생성
echo "index.js 파일을 생성합니다..."
cat << 'EOF' > index.js
const express = require('express');
const app = express();
const PORT = 3001;  // 사용할 포트 번호
app.get('/', (req, res) => {
  res.send('Hello, World!');  // 기본 응답
});
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

EOF
echo "개발자용 자동 재시작 도구를 설치합니다."
npm install nodemon

echo "mysql를 설치합니다."
brew install mysql

vrew services start mysql



echo "설정이 완료되었습니다. 'node index.js' 명령어로 서버를 시작할 수 있습니다."
