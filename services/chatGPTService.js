// services/chatGPTService.js
import 'dotenv/config';
import OpenAI from 'openai';
import { fileURLToPath } from 'url'; 
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * analyzePlaceWithChatGPT
 * - placeInfo JSON을 ChatGPT에 전달, 업종·위치 키워드 30개 분석
 * - 브랜드명은 제외, 랜드마크/명소 언급도 파악
 * - 출력 포맷 예시로 "1) \"사당맛집\"" 등 리스트 형태를 예상
 *
 * @param {Object} placeInfo - JSON 형태의 업체정보
 * @returns {Promise<string[]>} 추출된 키워드 목록
 */
async function analyzePlaceWithChatGPT(placeInfo) {
  // (A) 시스템 지침
  const systemPrompt = `
당신은 전문 마케팅 컨설턴트입니다.
JSON 데이터를 보고 업종 특성과 지역 키워드를 추출하는 일을 잘합니다.
`;

  // (B) 사용자 요청
  const userPrompt = `
다음 JSON 데이터를 바탕으로:
1) 업종과 위치 관련 키워드를 공백(스페이스바) 없이 추출해 주세요.
2) JSON에 'name'이 있지만, 브랜드명은 제외해 주세요.
3) 근처 랜드마크, 명소에 관한 언급을 놓치지 않고 파악해 주세요.
4) 가장 많이 검색될 것 같은 키워드 30개를 추출해 주세요.
5) 단, 키워드의 조합은 항상 위치키워드(랜드마크, 명소, 건물, 지역, 주소 등) + 업체특징키워드(맛집, 헬스장, PT, 술집, 고기집, 횟집, 메뉴명, 헤어샵, 서비스명 등) 로 구성되어있어야 합니다.

JSON 데이터:
\`\`\`json
${JSON.stringify(placeInfo, null, 2)}
\`\`\`

출력 포맷 (예시):
1) "사당맛집"
2) "이수역맛집"
3) "이수역술집"
4) "사당술집"
5) "사당맛집추천"
...
`;

  try {
    // (C) ChatGPT API 호출
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // 필요에 따라 모델 변경
      messages: [
        { role: 'system', content: systemPrompt.trim() },
        { role: 'user', content: userPrompt.trim() }
      ],
      temperature: 0.7,  // 창의성 수준
      max_tokens: 300,   // 응답 최대 토큰 (30개 키워드면 300 정도 여유)
    });

    const answer = response.choices?.[0]?.message?.content || '';
    if (!answer) {
      console.warn('[WARN] ChatGPT returned empty answer.');
      return [];
    }

    // (D) 응답에서 키워드 추출
    //  가정: ChatGPT가 아래처럼 줄바꿈 형태:
    //    1) "사당맛집"
    //    2) "이수역술집"
    // ...
    const lines = answer.split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const keywords = [];
    for (const line of lines) {
      // 정규식: "사당맛집"
      // 중간에 1) 또는 2), 3) 등은 무시
      const match = line.match(/\"(.+?)\"/);
      if (match && match[1]) {
        keywords.push(match[1]);
      }
    }

    // (E) 키워드가 하나도 못 뽑혔으면, 전체 응답을 한 번에 반환
    if (keywords.length === 0) {
      return [answer];
    }
    return keywords;
  } catch (error) {
    console.error('[ERROR] analyzePlaceWithChatGPT:', error.message);
    return [];
  }
}

export { analyzePlaceWithChatGPT };

// -------------------------------------------------------
// 아래는 테스트용 구문입니다.
// "node chatGPTService.js"로 직접 실행하면 출력값을 확인할 수 있습니다.
// -------------------------------------------------------
if (__filename === process.argv[1]) {
  (async () => {
    // 테스트용 placeInfo 예시
    const testPlaceInfo = {
      "placeId": "1971062401",
      "name": "낯선한식븟다",
      "category": "요리주점",
      "address": "서울 동작구 사당동 1006-30",
      "roadAddress": "서울 동작구 사당로30길 28 1층",
      "keywordList": [
        "닭볶음탕",
        "해창막걸리",
        "연어",
        "복순도가",
        "사당술집"
      ],
      "blogReviewTitles": [
        "[낯선한식븟다] 이수역 퓨전 한식 주점 맛집. 전국 다양한 막걸리와 소주. 색다른 문어요리뽈뽀. 크림소스 가득한 곱창순대크림스튜. 예약 필수.",
        "[이수역맛집]낯선한식 븟다",
        "낯선 한식 븟다이수 전통주 맛집",
        "[사당맛집/이수역맛집] 낯선 한식 븟다 다양한 메뉴와 전통주가 맛있는 곳!",
        "[이수역/총신대역] 퓨전한식, 전통주가 있는 요리주점, 낯선한식븟다 (내돈내산)",
        "서울 동작 ㅣ 낯선한식븟다 내돈내산 사당 이수 한식주점 청모장소 추천 + 뽈뽀, 우삼겹미나리전, 쵸리조봉골레탕",
        "낯선한식붓다 이수맛집 이수술집 이수역맛집 사당맛집 사당술집 사당역맛집 사당역술집 내돈내산",
        "이수/사당 낯선한식븟다 전통술",
        "[이수역 맛집] 연말 모임 장소로 좋았던 낯선한식븟다 내돈내산 방문후기",
        "이수 낯선한식 븟다"
      ],
      "shopIntro": "안녕하세요 사당역 술집 낮선한식븟다 입니다.\n막걸리를 비롯한 한국술 250 여 가지를 취급하는 한식주점으로\n시중에서 쉽게 보기 힘든 좋은 한국술과 퓨전한식을 함께 즐기실 수 있습니다.\n연인과 또는 친구와 오셨을 때 좋은 음식과 좋은 술로 좋은 시간을\n보내실 수 있도록 노력하겠습니다.\n예약은 캐치 테이블 어플 통해 가능합니다!^^\n(바로 위 웹 사이트 부분 눌러주시면 캐치 테이블로 연결됩니다.)"
    };

    try {
      console.log('[INFO] Testing analyzePlaceWithChatGPT with sample data...');
      const result = await analyzePlaceWithChatGPT(testPlaceInfo);
      console.log('[RESULT]', result);
    } catch (e) {
      console.error('[ERROR] Failed to analyze place info:', e);
    }
  })();
}
