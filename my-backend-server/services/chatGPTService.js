// services/chatGPTService.js
import 'dotenv/config';
import OpenAI from 'openai';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('ChatGPTService');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 주소에서 행정 경계를 추출하는 헬퍼 함수
 * @param {string} address - 주소 문자열 (예: "서울 관악구 신림동 1640-31")
 * @returns {string[]} 추출된 행정 경계 키워드 배열
 */
function extractAdministrativeBoundaries(address) {
  if (!address) return [];
  
  // 주소를 공백으로 분리
  const parts = address.split(/\s+/);
  const keywords = [];
  
  // 시/도 추출 (첫 번째 부분)
  if (parts.length > 0 && parts[0]) {
    keywords.push(parts[0]);
  }
  
  // 구/군 추출 (두 번째 부분)
  if (parts.length > 1 && parts[1]) {
    // 구/군 전체 추가
    keywords.push(parts[1]);
    
    // 구/군에서 '구'/'군' 접미사 제거한 기본 지역명 추출
    const districtBase = parts[1].replace(/(?:구|군)$/, '');
    if (districtBase && districtBase !== parts[1]) {
      keywords.push(districtBase);
    }
  }
  
  // 동/읍/면 추출 (세 번째 부분)
  if (parts.length > 2 && parts[2]) {
    // 동/읍/면 전체 추가
    keywords.push(parts[2]);
    
    // 동/읍/면에서 '동'/'읍'/'면' 접미사 제거한 기본 지역명 추출
    const neighborhoodBase = parts[2].replace(/(?:동|읍|면|가|리)$/, '');
    if (neighborhoodBase && neighborhoodBase !== parts[2]) {
      keywords.push(neighborhoodBase);
    }
  }
  
  // 중복 제거 및 공백 문자열 제거
  return keywords.filter((kw, index, self) => 
    kw.trim() !== '' && self.indexOf(kw) === index
  );
}

/**
 * ChatGPT에게 "locationKeywords", "featureKeywords" 두 배열만 추출하도록 요청
 * (최종 (주소+특징) 조합은 여기서 하지 않는다)
 *
 * @param {Object} placeInfo - JSON 형태의 업체정보
 * @returns {Promise<{locationKeywords:string[], featureKeywords:string[]}>}
 */
export async function analyzePlaceWithChatGPT(placeInfo) {
  // (A) 시스템 지침
  const systemPrompt = `아래 입력 JSON을 분석하여 '주소 키워드'(locationKeywords)와 '업체 특징 키워드'(featureKeywords)를 각각 추출하는 일을 잘합니다. 리스트 안의 값은 반드시 한국어로 작성해주세요.`;

  // (B) 사용자 요청  
  const userPrompt = `당신은 지금부터 텍스트를 분석하는 역할입니다. 아래 JSON 텍스트 보고 다음 [규칙]에 따라 **JSON 형식**으로 **locationKeywords**와 **featureKeywords**를 제공해주세요.
답변에 대한 근거를 간략하게 설명해준 이후에 JSON 형태로 출력해 주세요.

[규칙]
1. locationKeywords:
  * 'blogReviewTitles', 'shopIntro' 에서 **명소, 장소, 랜드마크, 관광지, 건물명, 근처역** 등 해당 업체가 현재 어느 지역, 위치에 있는지 나타내는 키워드를 전부 추출합니다. 그 중 지번 주소에 쓰이는 키워드는 행정경계(시, 도, 구, 군, 동, 읍, 면)를 추가한 키워드와 제거한 키워드 전부 추출합니다.
    (예: '사당동' 이 추출되었다면 '사당', '사당동' 을 추가합니다. '가평군'이 포함되었다면 '가평', '가평군' 을 추가합니다.)
  * 업체명, 브랜드명은 제외합니다.
  * 최대 15개 키워드까지만 추출합니다.

2. featureKeywords:
  * 'category', 'keywordList', 'blogReviewTitles', 'shopIntro'에서 업체의 메뉴, 판매상품, 제공하는 서비스, 업체를 일컫는 대명사를 나타내는 키워드를 최대 10개까지 추출합니다.
    (예: 회식장소, 소고기, 헬스장, PT, 데이트, 디저트, 삼겹살, 술집, 꽃집, 스크린골프, 증명사진 등)
  * 업체명, 브랜드명은 키워드 추출에서 제외합니다.
  * locationsKeywords와 중복되는 키워드는 제외합니다.

3) 답변 형태:
\`\`\`json
{
  "locationKeywords": {
    "명소": "남산타워",
    "랜드마크":
  }
  "featureKeywords": {
    "키워드1", "키워드2"
  }
}
\`\`\`

입력 JSON:
\`\`\`json
${JSON.stringify(placeInfo, null, 2)}
\`\`\`
`.trim();

  try {
    // (A) ChatGPT API 호출
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0,
      max_tokens: 1000,  // 토큰 수 증가
    });

    // (B) ChatGPT 답변 본문
    const answer = response.choices?.[0]?.message?.content?.trim() || '';
    logger.info('ChatGPT Answer:', answer);
    // (C) 정규식으로 ```json ... ``` 추출
    const jsonExtractRegex = /```(?:json)?\s*([\s\S]*?)```/;
    const jsonMatch = answer.match(jsonExtractRegex);
    console.log('JSON Match:', jsonMatch); // Fixed: Log the match result, not the regex
    
    let parsed;
    if (jsonMatch && jsonMatch[1]) {
      const rawJson = jsonMatch[1].trim();
      try {
        parsed = JSON.parse(rawJson);
      } catch (parseErr) {
        console.warn('[WARN] JSON parsing failed:', parseErr.message);
        logger.warn('Raw JSON content:', rawJson);
        
        // 더 강력한 후처리 시도: JSON 형식 수정 시도
        try {
          // 마지막에 누락된 괄호를 추가하는 등의 수정
          const fixedJson = rawJson.replace(/\}[\s]*$/, '}').replace(/\}[\s]*\][\s]*$/, '}]');
          parsed = JSON.parse(fixedJson);
          logger.info('[INFO] JSON fixed and parsed successfully');
        } catch (fixErr) {
          logger.warn('[WARN] JSON fix attempt failed:', fixErr.message);
          parsed = { locationKeywords: [], featureKeywords: [] };
        }
      }
    } else {
      // JSON 블록을 찾지 못한 경우, 응답 전체에서 JSON 객체 추출 시도
      logger.warn('[WARN] JSON 코드 블록을 찾을 수 없어 전체 응답에서 JSON 추출 시도');
      try {
        const jsonPattern = /\{\s*"locationKeywords"\s*:.*"featureKeywords"\s*:.*\}/s;
        const jsonCandidate = answer.match(jsonPattern);
        
        if (jsonCandidate && jsonCandidate[0]) {
          parsed = JSON.parse(jsonCandidate[0]);
          logger.info('[INFO] JSON extracted from full response');
        } else {
          parsed = { locationKeywords: [], featureKeywords: [] };
        }
      } catch (err) {
        logger.warn('[WARN] JSON 추출 실패:', err.message);
        parsed = { locationKeywords: [], featureKeywords: [] };
      }
    }
    // (D) 추출된 배열: ensure locationKeywords is always an array
    const rawLoc = parsed.locationKeywords || [];
    let locationKeywords = Array.isArray(rawLoc) ? rawLoc : Object.values(rawLoc);
    let featureKeywords = parsed.featureKeywords || [];
    
    // 필터: 문자열이 아닌 항목 제거
    locationKeywords = locationKeywords.filter(kw => typeof kw === 'string');
    featureKeywords = featureKeywords.filter(kw => typeof kw === 'string');

    // 주소에서 행정 경계 추출하여 locationKeywords에 추가
    if (placeInfo.address) {
      const addressKeywords = extractAdministrativeBoundaries(placeInfo.address);
      locationKeywords = [...locationKeywords, ...addressKeywords];
    }

    // (E) 공백 제거 (예: "프렌치 레스토랑" → "프렌치레스토랑")
    //     \s+는 "하나 이상의 공백 문자"를 의미, ''로 치환
    locationKeywords = locationKeywords.map((kw) => kw.replace(/\s+/g, ''));
    featureKeywords = featureKeywords.map((kw) => kw.replace(/\s+/g, ''));

    // (F) 필요한 후속 로직(중복 제거 등)이 있으면 추가
    const uniqueLoc = Array.from(new Set(locationKeywords));
    const uniqueFeat = Array.from(new Set(featureKeywords));
    
    // 두 배열 간의 중복 제거 (locationKeywords에 있는 키워드는 featureKeywords에서 제외)
    const finalFeat = uniqueFeat.filter(feat => !uniqueLoc.includes(feat));
    
    // (G) 레스토랑 특별 처리: 맛집 키워드 추가 및 '서울' 키워드 제거
    if (placeInfo.isRestaurant) {
      // 맛집 키워드 추가 (중복 방지)
      if (!finalFeat.includes('맛집')) {
        finalFeat.push('맛집');
      }
    }
      
    // '서울' 키워드 제거
    const seoulIndex = uniqueLoc.findIndex(kw => kw === '서울');
    if (seoulIndex !== -1) {
      uniqueLoc.splice(seoulIndex, 1);
    }
    // (H) 최종 반환: 변경된 반환값으로 deduplicated arrays 사용
    return {
      locationKeywords: uniqueLoc,
      featureKeywords: finalFeat,
    };
  } catch (error) {
    logger.error('[ERROR] analyzePlaceWithChatGPT:', error.message);
    return { locationKeywords: [], featureKeywords: [] };
  }
}