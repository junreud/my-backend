// src/models/Place.js

import { DataTypes } from "sequelize"
import sequelize from "../config/db.js"

const Place = sequelize.define(
  "Place",
  {
    // “URL에 있는 숫자”를 그대로 식별자로 쓸 거라면
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,   // ← 추가
      allowNull: false,
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    place_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    place_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "places",
    timestamps: false, // 수동으로 created_at, updated_at 관리
  }
)

export default Place
