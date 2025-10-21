// models/User.js
import { DataTypes, Model } from "sequelize";
import sequelize from "../config/db.js";  // 필요 시 .js 확장자
import bcrypt from "bcrypt";
import Place from './Place.js';

class User extends Model {
  /**
   * (1) createUser
   * 로컬 가입 or 소셜 가입 시 새 유저 생성
   */
  static async createUser({
    email,
    password, // 로컬이면 평문, 소셜이면 null
    name,
    provider = "local",
    provider_id = null,
    phone = null,
    date_of_birth = null,  // 새로 추가된 raw YYMMDD
    gender = null,     // 'male' or 'female'
    carrier = null,    // 통신사
    foreigner = false, // 기본값 false
    role = "user",     // 'admin' or 'user'
    is_completed = false,
  }) {
    let hashedPassword = null;
    if (provider === "local" && password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const user = await User.create({
      email,
      password: hashedPassword,
      provider,
      provider_id,
      name,
      phone,
      date_of_birth,  // 저장
      gender,
      carrier,
      foreigner,
      role,
      is_completed,
    });
    return user;
  }

  /**
   * (2) findByEmailAndProvider
   */
  static async findByEmailAndProvider(email, provider) {
    return User.findOne({ where: { email, provider } });
  }

  /**
   * (3) comparePassword
   * bcrypt 해시 비교
   */
  static async comparePassword(plainPassword, storedPassword) {
    if (storedPassword && storedPassword.startsWith("$2b$")) {
      return bcrypt.compare(plainPassword, storedPassword);
    } else {
      // (평문일 수 있으나 보안상 권장 안 함)
      return plainPassword === storedPassword;
    }
  }

  /**
   * (4) saveRefreshToken
   */
  static async saveRefreshToken(userId, refreshToken) {
    const user = await User.findByPk(userId);
    if (!user) return null;
    user.refresh_token = refreshToken;
    await user.save();
    return user;
  }

  /**
   * (5) findById
   */
  static async findById(id) {
    return User.findByPk(id);
  }

  /**
   * (6) findByGoogleId
   */
  static async findByGoogleId(googleId) {
    return User.findOne({
      where: { provider: "google", provider_id: googleId },
    });
  }

  /**
   * (7) findByRefreshToken
   */
  static async findByRefreshToken(refreshToken) {
    return User.findOne({ where: { refresh_token: refreshToken } });
  }

  /**
   * (8) 이메일 중복 체크
   *  - true = 사용 가능, false = 이미 있음
   */
  static async checkEmailAvailability(email) {
    const existing = await User.findOne({ where: { email } });
    return existing ? false : true;
  }

  /**
   * (8-1) clearRefreshToken
   * 로그아웃 시 refresh token 제거
   */
  static async clearRefreshToken(userId) {
    const user = await User.findByPk(userId);
    if (!user) return null;
    user.refresh_token = null;
    await user.save();
    return user;
  }

  /**
   * (9) updateUrlRegistration
   * url_registration 컬럼을 1로 업데이트
   */
  static async updateUrlRegistration(userId) {
    try {
      const user = await User.findByPk(userId);
      if (user) {
        user.url_registration = 1;
        await user.save();
      }
    } catch (err) {
      console.error('[ERROR] updateUrlRegistration:', err);
    }
  }
}

// ----------------------
// Sequelize 컬럼 정의
// ----------------------
User.init(
  {
    // 1) id
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    // 2) email
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    // 3) password
    password: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    // 4) provider
    provider: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "local",
    },
    // 5) provider_id
    provider_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    // 6) name
    name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    // 7) phone
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    // birthday8
    birthday8: {
      type: DataTypes.STRING(8),
      allowNull: true,
    },
    // 9) gender
    gender: {
      type: DataTypes.ENUM("MALE", "FEMALE"),
      allowNull: true,
    },
    // 10) role
    role: {
      type: DataTypes.ENUM("admin", "user"),
      allowNull: false,
      defaultValue: "user",
    },
    // 11) created_at
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    // 12) updated_at
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    // 13) refresh_token
    refresh_token: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    // 14) is_completed
    is_completed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // (추가) carrier (통신사)
    carrier: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    // (추가) foreigner (내/외국인 여부)
    foreigner: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    agree_marketing_term: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 0,
    },
    // (추가) url_registration
    url_registration: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 0,
    },
    avatar_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "users",
    modelName: "User",
    timestamps: false, // 수동으로 created_at / updated_at 사용 중
  }
);

// Add association so that User.places is defined
User.hasMany(Place, { as: 'places', foreignKey: 'user_id' });

export default User;