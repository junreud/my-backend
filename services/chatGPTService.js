// services/chatGPTService.js
import 'dotenv/config';
import { Configuration, OpenAIApi } from openai;
// 1) ENV에서 API KEY 로드
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('[ERROR] OPENAI_API_KEY is missing in your .env');
  process.exit(1);
}

// 2) OpenAI Configuration
const configuration = new Configuration({
  apiKey: OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

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
1) 업종과 위치 관련 키워드를 추출해 주세요.
2) JSON에 'name'이 있지만, 브랜드명은 제외해 주세요.
3) 근처 랜드마크, 명소에 관한 언급을 놓치지 않고 파악해 주세요.
4) 가장 많이 검색될 것 같은 키워드 30개를 추출해 주세요.

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
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo', // 필요에 따라 모델 변경
      messages: [
        { role: 'system', content: systemPrompt.trim() },
        { role: 'user', content: userPrompt.trim() }
      ],
      temperature: 0.7,  // 창의성 수준
      max_tokens: 300,   // 응답 최대 토큰 (30개 키워드면 300 정도 여유)
    });

    const answer = response.data.choices?.[0]?.message?.content || '';
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

module.exports = { analyzePlaceWithChatGPT };

// -------------------------------------------------------
// 아래는 테스트용 구문입니다.
// "node chatGPTService.js"로 직접 실행하면 출력값을 확인할 수 있습니다.
// -------------------------------------------------------
if (require.main === module) {
  (async () => {
    // 테스트용 placeInfo 예시
    const testPlaceInfo = {
      id: 123,
      name: "스타벅스 역삼점",
      address: "서울특별시 강남구 테헤란로",
      category: "커피 전문점",
      description: "서울 강남 테헤란로에 위치한 대형 프랜차이즈 카페.",
      nearByLandmark: "강남역, 역삼역"
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
