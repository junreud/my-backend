# 백엔드 개발 환경용 Dockerfile
FROM node:20-alpine

WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# 소스 코드 복사
COPY . .

# 환경 설정
ENV NODE_ENV=development
ENV PORT=4000

# 포트 노출
EXPOSE 4000

# 개발 서버 실행
CMD ["npm", "run", "dev"]
