'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // customer_info 테이블 생성
    await queryInterface.createTable('customer_info', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      posting_id: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
        comment: '공고 ID (중복 금지)',
      },
      title: {
        type: Sequelize.STRING(500),
        allowNull: false,
        comment: '공고 제목',
      },
      company_name: {
        type: Sequelize.STRING(200),
        allowNull: false,
        comment: '업체명',
      },
      address: {
        type: Sequelize.STRING(500),
        allowNull: true,
        comment: '주소',
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // contact_info 테이블 생성
    await queryInterface.createTable('contact_info', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      customer_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: {
          model: 'customer_info',
          key: 'id',
        },
        comment: 'customer_info 테이블의 ID',
      },
      phone_number: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: '전화번호',
      },
      contact_person: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: '담당자명',
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('contact_info');
    await queryInterface.dropTable('customer_info');
  }
};