"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Users", "url_registration", {
      type: Sequelize.INTEGER,     // 0,1 정수 값
      allowNull: false,
      defaultValue: 0,            // 기본값 0
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("Users", "url_registration");
  },
};
