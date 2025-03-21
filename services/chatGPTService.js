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
아래 JSON 데이터를 보고 다음 [규칙]에 따라 **JSON 형식**으로 **locationKeywords**와 **featureKeywords**를 제공해주세요.
설명은 간략하게만 해주세요.

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
   - **반드시 먼저 JSON 코드 블록**을 제공한 후 설명을 추가해 주세요:
   
   \`\`\`json
   {
     "locationKeywords": ["키워드1", "키워드2", ...],
     "featureKeywords": ["키워드1", "키워드2", ...]
   }
   \`\`\`
   
   - 그 다음에 간략하게 분류 이유를 설명해 주세요.

[JSON 데이터]
\`\`\`json
${JSON.stringify(placeInfo, null, 2)}
\`\`\`
`.trim();

  try {
    // (A) ChatGPT API 호출
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1000,  // 토큰 수 증가
    });

    // (B) ChatGPT 답변 본문
    const answer = response.choices?.[0]?.message?.content?.trim() || '';
    console.log('ChatGPT Answer:', answer);
    // (C) 정규식으로 ```json ... ``` 추출
    const jsonExtractRegex = /```json([\s\S]*?)```/;
    const jsonMatch = answer.match(jsonExtractRegex);

    console.log('JSON Match:', jsonMatch); // Fixed: Log the match result, not the regex
    
    let parsed;
    if (jsonMatch && jsonMatch[1]) {
      const rawJson = jsonMatch[1].trim();
      try {
        parsed = JSON.parse(rawJson);
      } catch (parseErr) {
        console.warn('[WARN] JSON parsing failed:', parseErr.message);
        console.warn('Raw JSON content:', rawJson);
        
        // 더 강력한 후처리 시도: JSON 형식 수정 시도
        try {
          // 마지막에 누락된 괄호를 추가하는 등의 수정
          const fixedJson = rawJson.replace(/\}[\s]*$/, '}').replace(/\}[\s]*\][\s]*$/, '}]');
          parsed = JSON.parse(fixedJson);
          console.log('[INFO] JSON fixed and parsed successfully');
        } catch (fixErr) {
          console.warn('[WARN] JSON fix attempt failed:', fixErr.message);
          parsed = { locationKeywords: [], featureKeywords: [] };
        }
      }
    } else {
      // JSON 블록을 찾지 못한 경우, 응답 전체에서 JSON 객체 추출 시도
      console.warn('[WARN] JSON 코드 블록을 찾을 수 없어 전체 응답에서 JSON 추출 시도');
      try {
        const jsonPattern = /\{\s*"locationKeywords"\s*:.*"featureKeywords"\s*:.*\}/s;
        const jsonCandidate = answer.match(jsonPattern);
        
        if (jsonCandidate && jsonCandidate[0]) {
          parsed = JSON.parse(jsonCandidate[0]);
          console.log('[INFO] JSON extracted from full response');
        } else {
          parsed = { locationKeywords: [], featureKeywords: [] };
        }
      } catch (err) {
        console.warn('[WARN] JSON 추출 실패:', err.message);
        parsed = { locationKeywords: [], featureKeywords: [] };
      }
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