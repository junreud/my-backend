// models/WorkHistory.js
import { DataTypes, Model } from "sequelize";
import sequelize from "../config/db.js";
import UserPlaceKeyword from "./UserPlaceKeyword.js";

class WorkHistory extends Model {
  /**
   * (1) createWorkHistory
   * 새 작업 이력 생성
   */
  static async createWorkHistory({
    user_id,
    place_id,
    work_type,
    executor,
    contract_keyword,
    work_keyword,
    char_count,
    actual_start_date,
    actual_end_date,
    user_start_date,
    user_end_date,
    company_characteristics,
  }) {
    const workHistory = await WorkHistory.create({
      user_id,
      place_id,
      work_type,
      executor,
      contract_keyword,
      work_keyword,
      char_count,
      actual_start_date,
      actual_end_date,
      user_start_date,
      user_end_date,
      company_characteristics,
    });
    return workHistory;
  }

  /**
   * (2) findByUserId
   * 유저 ID로 작업 이력 조회
   */
  static async findByUserId(userId) {
    return WorkHistory.findAll({
      where: { user_id: userId },
      include: [
        { 
          model: UserPlaceKeyword,
          as: "userPlaceKeyword",
          where: { user_id: userId }
        }
      ],
      order: [["created_at", "DESC"]]
    });
  }

  /**
   * (3) findByPlaceId
   * 장소 ID로 작업 이력 조회
   */
  static async findByPlaceId(placeId) {
    return WorkHistory.findAll({
      where: { place_id: placeId },
      include: [
        {
          model: UserPlaceKeyword,
          as: "userPlaceKeyword",
          where: { place_id: placeId }
        }
      ],
      order: [["created_at", "DESC"]]
    });
  }

  /**
   * (4) findByWorkType
   * 작업 종류별 이력 조회
   */
  static async findByWorkType(workType) {
    return WorkHistory.findAll({
      where: { work_type: workType },
      include: [
        {
          model: UserPlaceKeyword,
          as: "userPlaceKeyword"
        }
      ],
      order: [["created_at", "DESC"]]
    });
  }

    /**
     * (5) updateWorkHistory
     * 작업 이력 업데이트
     */
    static async updateWorkHistory(id, updateData) {
        const workHistory = await WorkHistory.findByPk(id);
        if (!workHistory) return null;
        
        await workHistory.update(updateData);
        return workHistory;
    }

    static async findAllForAdmin({ limit = 100, offset = 0 }) {
        try {
            console.log(`[DEBUG] findAllForAdmin 호출됨: limit=${limit}, offset=${offset}`);
            
            // userId 파라미터 무시, 항상 모든 작업 이력 조회
            console.log(`[DEBUG] 모든 사용자 데이터 조회 (필터 없음)`);
            
            // 실제 SQL 쿼리를 로깅
            console.log(`[DEBUG] 실행될 SQL 쿼리: SELECT * FROM work_histories ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`);
            
            // 직접 count 쿼리 실행
            const count = await WorkHistory.count();
            console.log(`[DEBUG] 총 레코드 수: ${count}`);
            
            // 결과 조회 (userId 필터링 없음)
            const results = await WorkHistory.findAll({
              attributes: { 
                exclude: ['created_at', 'updated_at'] 
              },
              order: [['id', 'DESC']],
              limit,
              offset
            });
            
            console.log(`[DEBUG] 조회된 레코드 수: ${results.length}`);
            return results;
          } catch (error) {
            console.error(`[ERROR] findAllForAdmin 메서드 실행 중 오류:`, error);
            throw error;
          }
    }
}
// ----------------------
// Sequelize 컬럼 정의
// ----------------------
WorkHistory.init(
  {
    // 1) id
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    // 2) user_id
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    // 3) place_id
    place_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    // 4) work_type (작업종류: 트래픽, 저장하기, 블로그배포)
    work_type: {
      type: DataTypes.ENUM("트래픽", "저장하기", "블로그배포"),
      allowNull: false,
    },
    // 5) executor (작업 실행사)
    executor: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    // 6) contract_keyword (계약키워드)
    contract_keyword: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    // 7) work_keyword (작업키워드)
    work_keyword: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    // 8) char_count (타수)
    char_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
    },
    // 9) actual_start_date (실제 작업시작일)
    actual_start_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // 10) actual_end_date (실제 작업종료일)
    actual_end_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // 11) user_start_date (유저 작업시작일)
    user_start_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // 12) user_end_date (유저 작업종료일)
    user_end_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // 13) company_characteristics (업체특징)
    company_characteristics: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // 14) created_at
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    // 15) updated_at
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    }
  },
  {
    sequelize,
    tableName: "work_histories",
    modelName: "WorkHistory",
    timestamps: false, // 수동으로 created_at / updated_at 사용
  }
);

export default WorkHistory;
