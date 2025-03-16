// services/chatGPTService.js
import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * ChatGPT에게 "locationKeywords", "featureKeywords" 두 배열만 추출하도록 요청
 * (최종 (주소+특징) 조합은 여기서 하지 않는다)
 *
 * @param {Object} placeInfo - JSON 형태의 업체정보
 * @returns {Promise<{locationKeywords:string[], featureKeywords:string[]}>}
 */
export async function analyzePlaceWithChatGPT(placeInfo) {
  // (A) 시스템 지침
  const systemPrompt = `
당신은 전문 마케팅 컨설턴트입니다. 
아래 JSON을 분석하여 '주소 키워드'(locationKeywords)와 '업체 특징 키워드'(featureKeywords)를 
각각 중복 없이 추출하는 일을 잘합니다.
답변은 반드시 한국어로 작성해주세요.
`;

  // (B) 사용자 요청  
  const userPrompt = `
아래 JSON 데이터를 보고 다음 [규칙]에 따라 **키워드 추출 과정과 그 이유**를 먼저 설명한 뒤, 
마지막에 **JSON 형식**으로 **locationKeywords**와 **featureKeywords**를 제공해주세요.

[규칙]
1) locationKeywords:
   - 'address'에서 시/동/구/읍/면이 포함된 키워드를 추출합니다. 
     그 후 해당 시/동/구/읍/면을 분리한 키워드도 중복 없이 추가로 추출합니다.
     예) "사당동" → ["사당동", "사당"], "동작구" → ["동작구", "동작"]  
   - 'blogReviewTitles', 'shopIntro', 'category'에서 **명소, 장소, 랜드마크, 관광지, 건물명** 등의 키워드를 추출합니다.
   - **업체명**, **브랜드명**은 절대 제외합니다.
   - 최대 **10개** 키워드까지만 추출합니다.

2) featureKeywords:
   - 'category', 'keywordList', 'blogReviewTitles', 'shopIntro'에서 
     업체의 메뉴, 음식 특징, 서비스, 분위기, 강점 등을 나타내는 키워드를 최대 5개까지 추출.
   - 음식점(외식업)인 경우, "맛집" 키워드 추가.
   - 명소나 장소는 locationKeywords에만 넣고, featureKeywords에는 넣지 않음.
   - 업체명/브랜드명/행정명은 제외.
   - **예외 규칙**: "고기집", "소고기집", "양식집", "치킨집"처럼  
     뒤가 **'집'**으로 끝나는 단어는 장소가 아니라 '업종' 키워드로 간주하여  
     **무조건 featureKeywords에만** 넣는다. locationKeywords에 절대 포함하지 않는다.
     
3) 답변 형태:
   - 먼저, 왜 그 키워드를 locationKeywords 혹은 featureKeywords로 분류했는지 간략히 설명합니다. (한국어)
   - 마지막에 **JSON 코드 블록**(\`\`\`json ... \`\`\`)에 
     **locationKeywords** 배열과 **featureKeywords** 배열을 제공해주세요.
   - JSON 내부엔 설명이나 주석을 넣지 말고 순수 키워드만 작성해주십시오.

[JSON 데이터]
\`\`\`json
${JSON.stringify(placeInfo, null, 2)}
\`\`\`
`.trim();

  try {
    // (A) ChatGPT API 호출
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',  // 모델명은 예시
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    // (B) ChatGPT 답변 본문
    const answer = response.choices?.[0]?.message?.content?.trim() || '';

    // (C) 정규식으로 ```json ... ``` 추출
    const jsonExtractRegex = /```json([\s\S]*?)```/;
    const jsonMatch = answer.match(jsonExtractRegex);

    let parsed;
    if (jsonMatch && jsonMatch[1]) {
      const rawJson = jsonMatch[1].trim();
      try {
        parsed = JSON.parse(rawJson);
      } catch (parseErr) {
        console.warn('[WARN] JSON parsing failed:', rawJson);
        parsed = { locationKeywords: [], featureKeywords: [] };
      }
    } else {
      console.warn('[WARN] JSON 형식의 데이터를 찾을 수 없습니다.');
      parsed = { locationKeywords: [], featureKeywords: [] };
    }

    // (D) 추출된 배열
    let locationKeywords = parsed.locationKeywords || [];
    let featureKeywords = parsed.featureKeywords || [];

    // (E) 공백 제거 (예: "프렌치 레스토랑" → "프렌치레스토랑")
    //     \s+는 "하나 이상의 공백 문자"를 의미, ''로 치환
    locationKeywords = locationKeywords.map((kw) => kw.replace(/\s+/g, ''));
    featureKeywords = featureKeywords.map((kw) => kw.replace(/\s+/g, ''));

    // (F) 필요한 후속 로직(중복 제거 등)이 있으면 추가
    const uniqueLoc = Array.from(new Set(locationKeywords));
    const uniqueFeat = Array.from(new Set(featureKeywords));

    // (G) 최종 반환: 변경된 반환값으로 deduplicated arrays 사용
    return {
      locationKeywords: uniqueLoc,
      featureKeywords: uniqueFeat,
    };

  } catch (error) {
    console.error('[ERROR] analyzePlaceWithChatGPT:', error.message);
    return { locationKeywords: [], featureKeywords: [] };
  }
}