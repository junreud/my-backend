// migrations/20250628-create-branding-blogs.js
'use strict';

export async function up(queryInterface, Sequelize) {
  // BrandingBlog 테이블 생성
  await queryInterface.createTable('branding_blogs', {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: Sequelize.INTEGER
    },
    place_id: {
      type: Sequelize.STRING,
      allowNull: false,
      comment: '네이버 플레이스 ID'
    },
    place_name: {
      type: Sequelize.STRING,
      allowNull: false,
      comment: '업체명'
    },
    blog_url: {
      type: Sequelize.STRING,
      allowNull: false,
      comment: '브랜딩 블로그 URL (네이버 플레이스에서 등록된)'
    },
    blog_id: {
      type: Sequelize.STRING,
      allowNull: false,
      comment: '블로그 ID (예: earlybirdgym)'
    },
    platform: {
      type: Sequelize.STRING,
      defaultValue: 'naver_blog',
      comment: '블로그 플랫폼 (naver_blog, instagram 등)'
    },
    is_active: {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
      comment: '활성 상태'
    },
    last_crawled_at: {
      type: Sequelize.DATE,
      comment: '마지막 크롤링 시간'
    },
    crawl_count: {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      comment: '총 크롤링 횟수'
    },
    created_at: {
      allowNull: false,
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    },
    updated_at: {
      allowNull: false,
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
    },
    deleted_at: {
      type: Sequelize.DATE
    }
  });

  // BrandingBlogPost 테이블 생성
  await queryInterface.createTable('branding_blog_posts', {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: Sequelize.INTEGER
    },
    branding_blog_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'branding_blogs',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    },
    post_url: {
      type: Sequelize.STRING,
      allowNull: false,
      comment: '블로그 글 URL'
    },
    title: {
      type: Sequelize.TEXT,
      allowNull: false,
      comment: '블로그 글 제목'
    },
    content: {
      type: Sequelize.TEXT,
      comment: '블로그 글 내용'
    },
    author: {
      type: Sequelize.STRING,
      comment: '작성자'
    },
    published_at: {
      type: Sequelize.DATE,
      allowNull: false,
      comment: '글 작성 시간'
    },
    is_branding_post: {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
      comment: '브랜딩 포스트 여부'
    },
    search_check_status: {
      type: Sequelize.ENUM('pending', 'checking', 'found', 'not_found', 'missed'),
      defaultValue: 'pending',
      comment: '검색 확인 상태'
    },
    search_attempts: {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      comment: '검색 시도 횟수'
    },
    first_search_at: {
      type: Sequelize.DATE,
      comment: '첫 번째 검색 시간 (작성 후 3시간)'
    },
    second_search_at: {
      type: Sequelize.DATE,
      comment: '두 번째 검색 시간 (작성 후 9시간)'
    },
    third_search_at: {
      type: Sequelize.DATE,
      comment: '세 번째 검색 시간 (작성 후 15시간)'
    },
    search_results: {
      type: Sequelize.JSON,
      comment: '검색 결과 저장 (각 시도별 결과)'
    },
    naver_ranking: {
      type: Sequelize.INTEGER,
      comment: '네이버 검색 결과 순위 (1-3위까지만, 없으면 null)'
    },
    is_ad: {
      type: Sequelize.BOOLEAN,
      comment: '광고 여부'
    },
    ad_confidence: {
      type: Sequelize.INTEGER,
      comment: '광고 신뢰도'
    },
    created_at: {
      allowNull: false,
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    },
    updated_at: {
      allowNull: false,
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
    },
    deleted_at: {
      type: Sequelize.DATE
    }
  });

  // 인덱스 추가
  await queryInterface.addIndex('branding_blogs', ['place_id']);
  await queryInterface.addIndex('branding_blogs', ['blog_id']);
  await queryInterface.addIndex('branding_blogs', ['place_id', 'blog_url'], { unique: true });

  await queryInterface.addIndex('branding_blog_posts', ['branding_blog_id']);
  await queryInterface.addIndex('branding_blog_posts', ['search_check_status']);
  await queryInterface.addIndex('branding_blog_posts', ['published_at']);
  await queryInterface.addIndex('branding_blog_posts', ['post_url'], { unique: true });
  await queryInterface.addIndex('branding_blog_posts', ['first_search_at']);
  await queryInterface.addIndex('branding_blog_posts', ['second_search_at']);
  await queryInterface.addIndex('branding_blog_posts', ['third_search_at']);
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.dropTable('branding_blog_posts');
  await queryInterface.dropTable('branding_blogs');
}
