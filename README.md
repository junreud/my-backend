# Marketing API Backend

## 🎯 프로젝트 개요

marketing-api-backend는 **Marketing Keyword Dashboard**를 위한 종합 백엔드 API 서버입니다. 키워드 순위 추적, SEO 분석, 사용자 인증, 비즈니스 관리 등 마케팅 대시보드의 모든 핵심 기능을 지원하는 고성능 RESTful API를 제공합니다.

## 🚀 핵심 기능

### 🔐 인증 및 사용자 관리
- **JWT 기반 인증**: 안전한 토큰 기반 인증 시스템
- **OAuth 통합**: Google, 네이버 소셜 로그인 지원
- **사용자 권한 관리**: 일반 사용자 및 관리자 권한 분리
- **계정 연동**: 소셜 계정과 이메일 계정 연동 기능

### 📊 키워드 분석 API
- **실시간 순위 추적**: 네이버, 구글 검색 결과 크롤링
- **AI 키워드 생성**: OpenAI GPT 기반 스마트 키워드 추천
- **순위 히스토리**: 시계열 데이터 저장 및 조회
- **검색량 분석**: 키워드별 월간 검색량 데이터

### 🏢 비즈니스 관리 API
- **업체 정보 관리**: 비즈니스 프로필 등록 및 관리
- **지역별 분석**: 지역 기반 검색 결과 필터링
- **경쟁사 모니터링**: 동일 키워드 경쟁업체 분석

### 📈 SEO 최적화 API
- **SEO 분석**: 웹사이트 SEO 점수 및 개선사항 분석
- **리뷰 크롤링**: 비즈니스 리뷰 데이터 수집 및 분석
- **콘텐츠 분석**: Google Cloud Vision API 연동 이미지 분석

### 📧 커뮤니케이션
- **이메일 서비스**: AWS SES 기반 알림 및 인증 메일
- **푸시 알림**: 실시간 순위 변동 알림
- **보고서 생성**: 자동화된 주기별 분석 리포트

## 🛠 기술 스택

### Backend Framework
- **Node.js**: JavaScript 런타임 환경
- **Express.js**: 웹 애플리케이션 프레임워크
- **ES Modules**: 최신 JavaScript 모듈 시스템

### 데이터베이스 및 ORM
- **MySQL**: 관계형 데이터베이스
- **Sequelize**: ORM (Object-Relational Mapping)
- **Connection Pooling**: 효율적인 데이터베이스 연결 관리

### 외부 서비스 연동
- **AWS SDK**: Amazon Web Services 통합
  - SES (Simple Email Service): 이메일 발송
  - S3: 파일 저장소
- **Google Cloud Vision**: 이미지 분석 API
- **OpenAI API**: ChatGPT 기반 키워드 생성
- **Puppeteer**: 웹 크롤링 및 자동화

### 보안 및 인증
- **bcrypt**: 비밀번호 해싱
- **jsonwebtoken**: JWT 토큰 생성 및 검증
- **express-validator**: 입력 데이터 검증
- **cors**: Cross-Origin Resource Sharing

### 개발 도구
- **TypeScript**: 타입 안정성 (설정 파일)
- **ESLint**: 코드 품질 관리
- **Docker**: 컨테이너화 지원
- **Bull**: 큐 기반 작업 처리

## 📁 폴더 구조

```
my-backend/
├── routes/                 # API 라우트 정의
│   ├── authRoutes.js      # 인증 관련 API
│   ├── userRoutes.js      # 사용자 관리 API
│   ├── keywordRoutes.js   # 키워드 분석 API
│   └── seoRoutes.js       # SEO 분석 API
├── controllers/           # 비즈니스 로직
│   ├── authController.js  # 인증 로직
│   ├── keywordController.js # 키워드 처리 로직
│   └── seoController.js   # SEO 분석 로직
├── models/               # 데이터베이스 모델
│   ├── User.js          # 사용자 모델
│   ├── Keyword.js       # 키워드 모델
│   └── Place.js         # 비즈니스 장소 모델
├── middlewares/         # 미들웨어
│   ├── auth.js         # 인증 미들웨어
│   ├── validation.js   # 입력 검증
│   └── common.js       # 공통 미들웨어
├── services/           # 외부 서비스 연동
│   ├── emailService.js # 이메일 발송
│   ├── crawlService.js # 웹 크롤링
│   └── aiService.js    # AI API 연동
├── utils/              # 유틸리티 함수
│   ├── logger.js       # 로깅 시스템
│   ├── database.js     # 데이터베이스 설정
│   └── helpers.js      # 공통 헬퍼 함수
├── config/             # 설정 파일
│   ├── database.js     # DB 연결 설정
│   ├── auth.js         # 인증 설정
│   └── aws.js          # AWS 서비스 설정
└── migrations/         # 데이터베이스 마이그레이션
```

## 🔧 개발 환경 설정

### 필수 요구사항
- Node.js 18+
- MySQL 8.0+
- npm 또는 yarn

### 설치 및 실행

```bash
# 저장소 클론
git clone [repository-url]
cd my-backend

# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env

# 데이터베이스 마이그레이션
npm run migrate

# 개발 서버 실행
npm run dev

# 프로덕션 서버 실행
npm start
```

### 환경 변수 설정
`.env` 파일에 다음 변수들을 설정하세요:

```env
# 데이터베이스 설정
DB_HOST=localhost
DB_PORT=3306
DB_NAME=marketing_db
DB_USER=your_username
DB_PASSWORD=your_password

# JWT 설정
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret

# AWS 설정
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=ap-northeast-2

# Google Cloud 설정
GOOGLE_CLOUD_PROJECT_ID=your_project_id
GOOGLE_CLOUD_KEY_FILE=path/to/service-account.json

# OpenAI 설정
OPENAI_API_KEY=your_openai_api_key

# OAuth 설정
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
```

## 📡 API 엔드포인트

### 인증 API (`/api/auth`)
```
POST   /signup          # 회원가입
POST   /login           # 로그인
POST   /logout          # 로그아웃
POST   /refresh         # 토큰 갱신
GET    /google          # Google OAuth
GET    /naver           # Naver OAuth
POST   /verify          # 이메일 인증
POST   /forgot-password # 비밀번호 재설정
```

### 사용자 API (`/api/users`)
```
GET    /profile                    # 사용자 프로필 조회
PATCH  /profile                    # 프로필 업데이트
GET    /keyword-results            # 키워드 결과 조회
GET    /user-keywords             # 사용자 키워드 목록
GET    /keyword-ranking-details   # 키워드 순위 상세
GET    /main-keyword-chart-data   # 메인 키워드 차트 데이터
```

### 키워드 API (`/api/keywords`)
```
POST   /normalize                  # URL 정규화
POST   /store-place               # 업체 정보 저장
POST   /chatgpt                   # AI 키워드 생성
POST   /combine                   # 키워드 조합
POST   /search-volume             # 검색량 조회
POST   /save-selected             # 선택된 키워드 저장
POST   /user-keywords             # 사용자 키워드 추가
GET    /keyword-rankings-by-business # 업체별 키워드 순위
GET    /keyword-ranking-table     # 키워드 순위 테이블
GET    /history                   # 키워드 히스토리
PATCH  /main-keyword/:placeId     # 메인 키워드 변경
```

### SEO API (`/api/seo`)
```
POST   /analyze                   # SEO 분석 실행
GET    /result/:placeId          # SEO 결과 조회
POST   /crawl-reviews            # 리뷰 크롤링
```

## 🔐 보안 기능

### 인증 및 권한
- JWT 기반 인증 (Access Token + Refresh Token)
- 관리자 권한 분리 (`authenticateAdmin` 미들웨어)
- 비밀번호 해싱 (bcrypt)
- OAuth 2.0 통합 (Google, Naver)

### 데이터 검증
- Express Validator를 통한 입력 데이터 검증
- SQL Injection 방지 (Sequelize ORM)
- XSS 공격 방지
- CORS 정책 적용

### 모니터링 및 로깅
- 요청/응답 로깅
- 에러 추적 및 알림
- 성능 모니터링

## 🐳 배포 및 운영

### Docker 컨테이너화
```bash
# 도커 이미지 빌드
docker build -t marketing-api .

# 컨테이너 실행
docker run -p 3001:3001 marketing-api

# Docker Compose 실행
docker-compose up -d
```

### 프로덕션 고려사항
- PM2를 통한 프로세스 관리
- Nginx 리버스 프록시 설정
- SSL/TLS 인증서 적용
- 데이터베이스 백업 전략
- 로그 로테이션 설정

## 🤝 기여하기

1. 이 저장소를 포크합니다
2. 새 기능 브랜치를 생성합니다 (`git checkout -b feature/amazing-feature`)
3. 변경사항을 커밋합니다 (`git commit -m 'Add amazing feature'`)
4. 브랜치에 푸시합니다 (`git push origin feature/amazing-feature`)
5. Pull Request를 생성합니다

## 📞 지원 및 문의

프로젝트 관련 문의사항이나 버그 리포트는 GitHub Issues를 통해 제출해 주세요.

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참조하세요.

---

**Marketing API Backend**는 확장 가능하고 안정적인 마케팅 분석 플랫폼의 핵심 인프라를 제공합니다.