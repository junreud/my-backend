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
답변은 반드시 한국어로 작성하며, 오직 JSON 형태로만 내보내세요.
`;

  // (B) 사용자 요청  
  const userPrompt = `
아래 JSON 데이터를 보고 다음 규칙에 따라 추출된 결과를 오직 JSON 형태로만 답변해 주세요.

[규칙]
1) locationKeywords: 
   - 'address', 'blogReviewTitles', 'category', 'shopIntro'에서
     지하철역, 동·구·시, 주변 명소 등을 중복 없이 뽑는다.
   - 도로명, 업체명, 브랜드명은 제외.
   - 예) "사당역", "사당동", "동작구", "수성못", "동성로" 등

2) featureKeywords:
   - 'category', 'keywordList', 'blogReviewTitles', 'shopIntro' 등에서
     업종/서비스/메뉴/특징(예: "헬스장", "PT", "맛집", "술집" ,"마사지" 등)을 뽑는다.
   - 브랜드명, 업체명은 제외.
   - JSON에 실제 언급된 단어만 사용.

3) 최종 답변 예시(JSON 형태) (설명 문구 제외):
\`\`\`json
{
  "locationKeywords": ["사당역","남현동"],
  "featureKeywords": ["헬스장","PT","맛집"]
}
\`\`\`

4) 그 외 문장은 쓰지 말고, 위 예시처럼 JSON만 출력해 주세요.

JSON 데이터:
\`\`\`json
${JSON.stringify(placeInfo, null, 2)}
\`\`\`
`.trim();

  try {
    // (C) ChatGPT API 호출
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 2000,
    });

    // ChatGPT 답변
    const answer = response.choices?.[0]?.message?.content?.trim() || '';
    if (!answer) {
      console.warn('[WARN] ChatGPT returned empty answer.');
      return { locationKeywords: [], featureKeywords: [] };
    }

    // (D) 백틱 코드블록 제거 로직
    let rawAnswer = answer.trim();

    // 1) “```(json)? ... ```” 정규식으로 내부 내용만 추출
    const codeBlockRegex = /```[a-zA-Z]*([\s\S]*?)```/g;
    rawAnswer = rawAnswer.replace(codeBlockRegex, (match, p1) => p1.trim());

    // 2) 혹시 남아 있는 백틱(```)도 전부 제거
    rawAnswer = rawAnswer.replace(/```/g, '').trim();

    // (E) 이제 rawAnswer는 순수 JSON 문자열이길 기대
    let parsed;
    try {
      parsed = JSON.parse(rawAnswer);
    } catch (parseErr) {
      console.warn('[WARN] Failed to parse ChatGPT JSON. Cleaned answer:', rawAnswer);
      return { locationKeywords: [], featureKeywords: [] };
    }

    // (F) 최종 키워드 배열 반환
    const locationKeywords = parsed.locationKeywords || [];
    const featureKeywords = parsed.featureKeywords || [];
    return { locationKeywords, featureKeywords };

  } catch (error) {
    console.error('[ERROR] analyzePlaceWithChatGPT:', error.message);
    return { locationKeywords: [], featureKeywords: [] };
  }
}
