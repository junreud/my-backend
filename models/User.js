const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db'); // Sequelize 인스턴스
const bcrypt = require('bcrypt');

class User extends Model {
  /**
   * (1) createUser
   * 로컬 가입 or 소셜 가입 시 새 유저 생성
   */
  static async createUser({
    email,
    password,        // 로컬이면 평문, 소셜이면 null
    name,
    provider = 'local',
    provider_id = null,
    phone = null,
    date_of_birth = null,
    gender = null,   // 'male' or 'female'
    role = 'user',   // 'admin' or 'user'
    is_completed = false,
  }) {
    let hashedPassword = null;
    if (provider === 'local' && password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const user = await User.create({
      email,
      password: hashedPassword,
      name,
      provider,
      provider_id,
      phone,
      date_of_birth,
      gender,
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
    if (storedPassword && storedPassword.startsWith('$2b$')) {
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
      where: { provider: 'google', provider_id: googleId },
    });
  }

  /**
   * (7) findByRefreshToken
   */
  static async findByRefreshToken(refreshToken) {
    return User.findOne({ where: { refresh_token: refreshToken } });
  }

  /**
   * (8) 이메일 중복 체크 (true = 중복 아님, false = 중복)
   *  - 또는 필요에 따라 "isDuplicated"를 반환할 수도 있음
   */
  static async checkEmailAvailability(email) {
    const existing = await User.findOne({ where: { email } });
    // 만약 존재하면 -> 사용 불가 → false
    // 존재하지 않으면 사용 가능 → true
    return existing ? false : true;
  }
}

// 스키마에 맞는 Sequelize 정의
User.init(
  {
    // 1) id (PK, auto_increment)
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    // 2) email (varchar(255), unique)
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    // 3) password (nullable)
    password: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    // 4) provider (varchar(50), default 'local')
    provider: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'local',
    },
    // 5) provider_id
    provider_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    // 6) name (varchar(100), not null)
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    // 7) phone (varchar(20))
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    // 8) date_of_birth (date)
    date_of_birth: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    // 9) gender (enum('male','female'))
    gender: {
      type: DataTypes.ENUM('male', 'female'),
      allowNull: true,
    },
    // 10) role (enum('admin','user'), default 'user')
    role: {
      type: DataTypes.ENUM('admin', 'user'),
      allowNull: false,
      defaultValue: 'user',
    },
    // 11) created_at (datetime, not null)
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW, 
      // 실제 MySQL에서 "CURRENT_TIMESTAMP" 사용하려면 
      // defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') 등 가능
    },
    // 12) updated_at (datetime, not null)
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      // 마찬가지로 onUpdate CURRENT_TIMESTAMP를 자동화하려면 
      // hooks 또는 literal 사용 필요
    },
    // 13) refresh_token
    refresh_token: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    // 14) is_completed (tinyint(1) => boolean)
    is_completed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'users',
    modelName: 'User',
    // 이미 created_at, updated_at 칼럼이 수동 설정되어 있으므로
    // timestamps: false → Sequelize가 자동 컬럼(createdAt, updatedAt)을 만들지 않도록
    timestamps: false,
  }
);

module.exports = User;
