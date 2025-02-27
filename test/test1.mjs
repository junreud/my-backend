// test1.mjs (ESM 방식)
// 만약 package.json에 "type": "module"을 선언했다면 .js여도 됩니다.

// 1) dotenv
import dotenv from 'dotenv';
dotenv.config(); // .env 파일 로드

// 2) openai
import { Configuration, OpenAIApi } from 'openai';

// 3) API KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY is missing in .env');
  process.exit(1);
}

// 4) OpenAI Client
const configuration = new Configuration({ apiKey: OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

// 5) 실제 실행
(async () => {
  try {
    const placeInfo = {
      "placeId": "1971062401",
      "name": "낯선한식븟다",
      // ... (생략)
    };

    const systemPrompt = "당신은 전문 마케팅 컨설턴트입니다.";
    const userPrompt = `
다음 JSON 데이터를 참고하여 업체의 특성을 분석하고, 
위치 중심 키워드를 5개만 제안해 주세요 (브랜드명 제외).

JSON:
\`\`\`json
${JSON.stringify(placeInfo, null, 2)}
\`\`\`
`;

    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo', // 또는 gpt-4
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    const answer = response.data.choices[0]?.message?.content;
    console.log('=== ChatGPT 응답 ===\n', answer);
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
