'use strict';

/**
 * Example of a single migration creating multiple tables:
 * blog_review_logs, daily_ranking_logs, keywords, places, users
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) CREATE TABLE: keywords
    await queryInterface.createTable('keywords', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      keyword: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        onUpdate : Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    }, {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collate: 'utf8mb4_0900_ai_ci',
    });

    // Unique Key
    await queryInterface.addIndex('keywords', {
      name: 'uk_keywords_keyword',
      unique: true,
      fields: ['keyword'],
    });

    // 2) CREATE TABLE: places
    await queryInterface.createTable('places', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      naver_place_id: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      category: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        onUpdate : Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    }, {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collate: 'utf8mb4_0900_ai_ci',
    });

    // Unique Key
    await queryInterface.addIndex('places', {
      name: 'uk_places_naver_id',
      unique: true,
      fields: ['naver_place_id'],
    });

    // 3) CREATE TABLE: blog_review_logs
    await queryInterface.createTable('blog_review_logs', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      place_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'places',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      blog_title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      blog_url: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT('medium'), // mediumtext
        allowNull: true,
      },
      word_count: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      crawled_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    }, {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collate: 'utf8mb4_0900_ai_ci',
    });

    // Indexes
    await queryInterface.addIndex('blog_review_logs', {
      name: 'idx_brl_place_id',
      fields: ['place_id'],
    });
    await queryInterface.addIndex('blog_review_logs', {
      name: 'idx_brl_crawled_at',
      fields: ['crawled_at'],
    });

    // 4) CREATE TABLE: daily_ranking_logs
    await queryInterface.createTable('daily_ranking_logs', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      keyword_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'keywords',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      place_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'places',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      rank_position: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      star_rating: {
        type: Sequelize.DECIMAL(2,1),
        allowNull: true,
      },
      receipt_review_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      blog_review_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      crawled_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    }, {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collate: 'utf8mb4_0900_ai_ci',
    });

    // Indexes
    await queryInterface.addIndex('daily_ranking_logs', {
      name: 'idx_drl_keyword_id',
      fields: ['keyword_id'],
    });
    await queryInterface.addIndex('daily_ranking_logs', {
      name: 'idx_drl_place_id',
      fields: ['place_id'],
    });
    await queryInterface.addIndex('daily_ranking_logs', {
      name: 'idx_drl_crawled_at',
      fields: ['crawled_at'],
    });

    // 5) CREATE TABLE: users
     await queryInterface.createTable("users", {
        id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        email: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        password: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        provider: {
          type: Sequelize.STRING(50),
          allowNull: false,
          defaultValue: "local",
        },
        provider_id: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        name: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        phone: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },

        // date_of_birth: varchar(8)
        date_of_birth: {
          type: Sequelize.STRING(8),
          allowNull: true,
        },

        // gender: enum('male','female')
        gender: {
          type: Sequelize.ENUM("MALE", "FEMALE",),
          allowNull: true,
        },

        // role: enum('admin','user') default 'user'
        role: {
          type: Sequelize.ENUM("admin", "user"),
          allowNull: false,
          defaultValue: "user",
        },

        // refresh_token
        refresh_token: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },

        // carrier
        carrier: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },

        // foreigner: TINYINT (0 or 1) default 0
        foreigner: {
          type: Sequelize.TINYINT,
          allowNull: false,
          defaultValue: 0,
        },

        // created_at: datetime, default CURRENT_TIMESTAMP
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },

        // updated_at: datetime, default CURRENT_TIMESTAMP
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
          // 일부 MySQL 버전/환경에서 onUpdate 설정을 적용하려면:
          // onUpdate : Sequelize.literal('CURRENT_TIMESTAMP'),
        },

        // is_completed: TINYINT default 0
        is_completed: {
          type: Sequelize.TINYINT,
          allowNull: false,
          defaultValue: 0,
        },
      },
      {
        engine: "InnoDB",
        charset: "utf8mb4",
        collate: "utf8mb4_0900_ai_ci",
      }
    );   // Unique Key
    await queryInterface.addIndex('users', {
      name: 'uk_users_email',
      unique: true,
      fields: ['email'],
    });
  },

  async down(queryInterface, Sequelize) {
    // Drop in reverse order of creation
    await queryInterface.dropTable('daily_ranking_logs');
    await queryInterface.dropTable('blog_review_logs');
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('places');
    await queryInterface.dropTable('keywords');
  }
};
