import Place from "../models/Place.js";

// 수정: 올바른 서비스 파일 경로 사용
import { normalizePlaceUrl } from "../services/normalizePlaceUrl.js";
import { getNaverPlaceFullInfo } from "../services/naverPlaceFullService.js";
import { analyzePlaceWithChatGPT } from "../services/chatGPTService.js";
import { groupKeywordsByHttpFetch } from "../services/keywordGrounpingService.js";
import { getSearchVolumes } from "../services/naverAdApiService.js";
// 추가: Keyword 모델을 직접 임포트
import Keyword from "../models/Keyword.js";
import UserPlaceKeyword from "../models/UserPlaceKeyword.js";
// 추가: sequelize 임포트 (raw query 사용)
import sequelize from "../config/db.js";

export async function normalizeUrlHandler(req, res) {
  try {
    const { url, platform } = req.body;
    if (platform !== "naver") {
      return res.status(400).json({ success: false, message: "현재는 NAVER 플랫폼만 지원합니다." });
    }
    if (!url) {
      return res.status(400).json({ success: false, message: "url 파라미터가 필요합니다." });
    }

    const normalizedUrl = await normalizePlaceUrl(url);
    if (!normalizedUrl) {
      return res
        .status(400)
        .json({ success: false, message: "URL을 정규화할 수 없습니다." });
    }

    // (1) 장소 정보 가져오기
    const placeInfo = await getNaverPlaceFullInfo(normalizedUrl)

    // (2) Passport JWT 인증이 붙어 있다면, 여기서 req.user가 존재
    //     userId를 placeInfo에 추가하여 프론트로 전달
    const userId = req.user?.id
    if (!userId) {
      // 혹은 필요 시 401 리턴
      return res.status(401).json({
        success: false,
        message: "인증되지 않은 사용자입니다.",
      })
    }
    // placeInfo에 userid 필드로 넣기
    placeInfo.userid = userId

    console.log(`[INFO] Normalized URL = ${normalizedUrl}`)
    console.log(`[INFO] Place Info = ${JSON.stringify(placeInfo)}`)
    return res.json({
      success: true,
      normalizedUrl,
      placeInfo,
    })
  } catch (err) {
    console.error("[ERROR] normalizeUrlHandler:", err)
    return res.status(500).json({ success: false, message: err.message })
  }
}
/** 
 * 2) places 테이블에 저장 
 *    POST /analysis/store-place
 */
export async function storePlaceHandler(req, res) {
  try {
    console.log("storePlaceHandler body =", req.body)
    const { user_id, place_id, place_name, category, platform } = req.body
    if (!user_id || !place_id || !place_name) {
      return res.status(400).json({
        success: false,
        message: "user_id, place_id, place_name은 필수입니다.",
      })
    }

    // (A) 중복 체크: 이미 동일한 (user_id, place_id)가 존재하면
    const existing = await Place.findOne({ where: { user_id, place_id } })
    if (existing) {
      // 기존에는 400 에러를 보냈지만, 이제는 메시지와 함께 성공 응답을 돌려줍니다.
      console.log(
        `[INFO] place_id=${place_id} is already registered for user_id=${user_id}, skipping creation.`
      )
      return res.json({
        success: true,
        message: "이미 등록된 place이므로 새로 생성하지 않았습니다.",
      })
    }

    // (B) DB 저장
    await Place.create({
      user_id,
      place_id,
      place_name,
      category,
    })

    console.log(`[INFO] Stored place = ${place_name} (${place_id}) by user ${user_id}`)
    return res.json({ success: true })
  } catch (err) {
    console.error("[ERROR] storePlaceHandler:", err)
    return res.status(500).json({ success: false, message: err.message })
  }
}
/**
 * 3) ChatGPT 키워드 생성
 *    POST /analysis/chatgpt
 */
export async function chatgptKeywordsHandler(req, res) {
  try {
    const { placeInfo } = req.body
    // placeInfo에는 { shopIntro, blogReviewTitles... } 등 정보가 있다고 가정

    // ChatGPT 분석
    const { locationKeywords, featureKeywords } = await analyzePlaceWithChatGPT(placeInfo)

    // 혹은 category 쓰일 수 있음
    if (!locationKeywords.length && !featureKeywords.length) {
      // 빈 값이라도 일단 응답
      return res.json({ success: true, locationKeywords: [], featureKeywords: [] })
    }
    console.log(`[INFO] ChatGPT Keywords: ${locationKeywords}, ${featureKeywords}`)
    return res.json({
      success: true,
      locationKeywords,
      featureKeywords,
    })
  } catch (err) {
    console.error("[ERROR] chatgptKeywordsHandler:", err)
    return res.status(500).json({ success: false, message: err.message })
  }
}

// (B) Express 라우트 핸들러
export async function combineLocationAndFeaturesHandler(req, res) {
  try {
    // 1) req.body 로부터 locationKeywords, featureKeywords 추출
    console.log("[DEBUG] /keyword/combine req.body =", req.body)
    const { locationKeywords, featureKeywords } = req.body

    // 2) validation
    if (!Array.isArray(locationKeywords) || !Array.isArray(featureKeywords)) {
      return res.status(400).json({
        success: false,
        message: "locationKeywords, featureKeywords must be arrays",
      })
    }
    // (A) 순수 로직 함수
    function combineLocationAndFeatures({ locationKeywords, featureKeywords }) {
      const combinedSet = new Set()
      for (const loc of locationKeywords) {
        for (const feat of featureKeywords) {
          const keyword = loc + feat
          combinedSet.add(keyword)
        }
      }
      // 최대 100개만
      return Array.from(combinedSet).slice(0, 100)
    }

    // 3) 위에서 만든 순수 로직 함수 호출
    const finalArr = combineLocationAndFeatures({ locationKeywords, featureKeywords })

    // 4) 응답
    return res.json({
      success: true,
      candidateKeywords: finalArr,
    })
  } catch (err) {
    console.error("[ERROR] combineLocationAndFeaturesHandler:", err)
    return res.status(500).json({ success: false, message: err.message })
  }
}

/**
 * 5) 검색광고 API 조회 (검색량)
 *    POST /analysis/search-volume
 *    body: { candidateKeywords: string[] }
 */
export async function searchVolumesHandler(req, res) {
  try {
    // 1) candidateKeywords 배열
    const { candidateKeywords } = req.body;
    // 2) ?normalizedUrl=... 쿼리 파라미터로부터 isRestaurant 계산
    const { normalizedUrl } = req.query;
    const isRestaurant = normalizedUrl && normalizedUrl.includes("restaurant") ? 1 : 0;

    if (!Array.isArray(candidateKeywords)) {
      return res.status(400).json({
        success: false,
        message: "candidateKeywords must be an array",
      });
    }

    // 3) 검색광고 API 조회
    const externalDataList = await getSearchVolumes(candidateKeywords);
    console.log(`[INFO] External Data List: ${JSON.stringify(externalDataList)}`);

    // 4) DB 저장/업데이트
    await Promise.all(
      externalDataList.map(async (data) => {
        const { keyword, monthlySearchVolume } = data;
        if (!keyword) return;

        // DB에서 keyword 일치 여부 확인
        let keywordRecord = await Keyword.findOne({ where: { keyword } });
        if (keywordRecord) {
          // 이미 있으면 monthlySearchVolume, last_search_volume 및 isRestaurant 업데이트
          await keywordRecord.update({
            monthlySearchVolume,
            last_search_volume: monthlySearchVolume,
          
          });
        } else {
          // 없으면 새로 생성
          await Keyword.create({
            keyword,
            monthlySearchVolume,
            last_search_volume: monthlySearchVolume,
            isRestaurant,
          });
        }
      })
    );

    // 5) 응답
    return res.json({
      success: true,
      externalDataList,
    });
  } catch (err) {
    console.error("[ERROR] searchVolumesHandler:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}

/**
 * 6) 키워드 그룹핑
 *    POST /analysis/group
 *    body: { externalDataList: { keyword, monthlySearchVolume }[] }
 */
export async function groupKeywordsHandler(req, res) {
  try {
    const { externalDataList } = req.body;
    if (!externalDataList || !Array.isArray(externalDataList)) {
      return res.status(400).json({
        success: false,
        message: "externalDataList 배열 필요",
      });
    }

    // 1) 네이버 상위 10개 기반으로 그룹화
    const finalKeywords = await groupKeywordsByHttpFetch(externalDataList);

    // 콘솔 디버깅
    console.log("[DEBUG] finalKeywords =", finalKeywords);

    // 2) 여기서 바로 DB 저장 로직 호출 (에러 없이 처리하도록, 핸들러 대신 로직 함수 사용)
    await saveGroupedKeywordsLogic(finalKeywords);

    // 3) 응답
    return res.json({
      success: true,
      finalKeywords,
    });
  } catch (err) {
    console.error("[ERROR] groupKeywordsHandler:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * (로직 전용) 그룹화된 키워드들을 keyword_relations 테이블에 저장하는 함수
 *  - finalKeywords: [
 *      {
 *        "combinedKeyword": "사당역맛집, 사당맛집",
 *        "details": [ { "rank":1,"monthlySearchVolume":87900 }, ... ]
 *      },
 *      ...
 *    ]
 */
export async function saveGroupedKeywordsLogic(finalKeywords) {
  // finalKeywords 순회
  for (const group of finalKeywords) {
    if (!group.combinedKeyword) continue;

    // 쉼표(,)로 분리
    const splitted = group.combinedKeyword
      .split(",")
      .map((kw) => kw.trim())
      .filter((kw) => kw.length > 0);

    // (1) 2개 이상 묶인 경우에만 relations 테이블에 저장
    if (splitted.length < 2) {
      console.log(`[INFO] Skip single keyword: ${group.combinedKeyword}`);
      continue;
    }

    // (2) Keyword 테이블에서 검색/생성 -> keywordIds
    let keywordIds = [];
    for (const kw of splitted) {
      let keywordRecord = await Keyword.findOne({ where: { keyword: kw } });
      if (!keywordRecord) {
        keywordRecord = await Keyword.create({ keyword: kw });
      }
      keywordIds.push(keywordRecord.id);
    }

    // (3) 기존 keyword_relations 중에서
    //     related_keyword_id_1.._10 중 하나라도 keywordIds를 포함한 row가 있는지 찾음
    // -------------------------------------------------------------
    // (A) 여기를 **Named parameter**로 수정
    // -------------------------------------------------------------
    const orConditions = [];
    for (let i = 1; i <= 3; i++) {
      // "related_keyword_id_1 IN (:keywordIds) OR related_keyword_id_2 IN (:keywordIds) ..."
      orConditions.push(`related_keyword_id_${i} IN (:keywordIds)`);
    }
    const whereClause = orConditions.join(" OR ");

    const [existingRows] = await sequelize.query(
      `
        SELECT *
        FROM keyword_relations
        WHERE ${whereClause}
      `,
      {
        // <-- named parameter :keywordIds 에 keywordIds 배열을 그대로 매핑
        replacements: { keywordIds },
      }
    );

    // (4) 만약 기존 row가 있으면 -> 중복되지 않은 나머지를 추가 업데이트
    if (existingRows && existingRows.length > 0) {
      const row = existingRows[0];
      const rowKeywordIds = [];
      for (let i = 1; i <= 3; i++) {
        const colVal = row[`related_keyword_id_${i}`];
        if (colVal) rowKeywordIds.push(colVal);
      }
      // 새로 들어온 keywordIds 중 row에 없는 것만 추가
      const toAdd = keywordIds.filter((id) => !rowKeywordIds.includes(id));

      if (toAdd.length > 0) {
        let updateClauses = [];
        let replacements = [];
        let colIndex = 1;

        // 이미 값이 들어있는 컬럼이 몇 개인지 확인
        for (colIndex = 1; colIndex <= 3; colIndex++) {
          if (!row[`related_keyword_id_${colIndex}`]) {
            // 비어있으면 여기부터 채워넣는다
            break;
          }
        }

        // colIndex부터 toAdd를 차례대로 채우기 (10개 컬럼을 넘지 않는 선에서)
        for (let i = 0; i < toAdd.length; i++) {
          if (colIndex > 10) break;
          updateClauses.push(`related_keyword_id_${colIndex} = ?`);
          replacements.push(toAdd[i]);
          colIndex++;
        }

        if (updateClauses.length > 0) {
          const updateSql = `
            UPDATE keyword_relations
            SET ${updateClauses.join(", ")}
            WHERE id = ?
          `;
          replacements.push(row.id);

          await sequelize.query(updateSql, { replacements });
          console.log(
            `[INFO] Updated row(id=${row.id}) in keyword_relations with [${toAdd.join(",")}]`
          );
        }
      } else {
        console.log(
          `[INFO] All keywords already exist in row(id=${row.id}), skip.`
        );
      }
    } else {
      // (5) 기존 row가 전혀 없으면 -> 새 row INSERT
      const columns = [];
      const placeholders2 = [];
      const replacements2 = [];
      for (let i = 0; i < keywordIds.length && i < 10; i++) {
        columns.push(`related_keyword_id_${i + 1}`);
        placeholders2.push(`?`);
        replacements2.push(keywordIds[i]);
      }
      const insertSql = `
        INSERT INTO keyword_relations (${columns.join(", ")})
        VALUES (${placeholders2.join(", ")})
      `;
      await sequelize.query(insertSql, { replacements: replacements2 });

      console.log(
        `[INFO] Inserted new row in keyword_relations with keyword IDs = [${keywordIds.join(
          ","
        )}]`
      );
    }
  }
}

/**
 * (핸들러) 그룹화된 키워드를 keyword_relations 테이블에 저장
 * POST /keyword/save-grouped
 * body: { finalKeywords: [ { combinedKeyword: "...", details: ... }, ... ] }
 *
 * - 만약 프론트에서 바로 finalKeywords를 통째로 전송해 저장만 하고 싶을 때 사용
 * - groupKeywordsHandler와는 별도로 사용할 수 있도록 남겨둠
 */
export async function saveGroupedKeywordsHandler(req, res) {
  try {
    const { finalKeywords } = req.body;
    if (!Array.isArray(finalKeywords)) {
      return res.status(400).json({
        success: false,
        message: "finalKeywords 배열이 필요합니다.",
      });
    }

    // 바로 로직 함수 호출
    await saveGroupedKeywordsLogic(finalKeywords);

    return res.json({ success: true, message: "Grouped keywords saved." });
  } catch (err) {
    console.error("[ERROR] saveGroupedKeywordsHandler:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * #7. 사용자가 선택한 키워드들을 user_place_keywords 테이블에 저장
 * POST /keyword/save-selected
 * body: { finalKeywords: [{ combinedKeyword, details?: ... }]}
 */
export async function saveSelectedKeywordsHandler(req, res) {
  try {
    const { finalKeywords } = req.body;
    const userId = req.user?.id; // JWT 인증으로부터 가져온 유저 ID (가정)

    if (!Array.isArray(finalKeywords)) {
      return res.status(400).json({
        success: false,
        message: "finalKeywords 배열이 필요합니다.",
      });
    }
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "인증되지 않은 사용자입니다.",
      });
    }

    // (1) userId 에 해당하는 place 가져오기 (1:1 가정)
    const place = await Place.findOne({ where: { user_id: userId } });
    if (!place) {
      return res.status(404).json({
        success: false,
        message: "해당 유저에 대한 Place 정보를 찾을 수 없습니다.",
      });
    }
    const placeId = place.place_id;

    // (2) finalKeywords 순회 => user_place_keywords 테이블에 저장
    for (const group of finalKeywords) {
      if (!group.combinedKeyword || typeof group.combinedKeyword !== "string") {
        console.log("combinedKeyword가 없거나 문자열이 아님: ", group);
        continue;
      }

      // 쉼표로 분리
      const splitted = group.combinedKeyword
        .split(",")
        .map((kw) => kw.trim())
        .filter((kw) => kw.length > 0);

      // 각각 Keyword 테이블 확인/생성
      const keywordRecords = [];
      for (const kw of splitted) {
        let keywordRecord = await Keyword.findOne({ where: { keyword: kw } });
        if (!keywordRecord) {
          keywordRecord = await Keyword.create({ keyword: kw });
        }
        keywordRecords.push(keywordRecord);
      }

      for (const record of keywordRecords) {
        // upsert() 사용 (단, (user_id, place_id, keyword_id)에 UNIQUE KEY 있어야 중복판별 가능)
        await UserPlaceKeyword.upsert({
          user_id: userId,
          place_id: placeId,
          keyword_id: record.id,
          platform: place.platform,
        });
      }
    }

    return res.json({ success: true, message: "Selected keywords saved." });
  } catch (err) {
    console.error("[ERROR] saveSelectedKeywordsHandler:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}