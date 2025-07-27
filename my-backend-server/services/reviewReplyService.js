// services/reviewReplyService.js
import 'dotenv/config';
import OpenAI from 'openai';
import { createLogger } from '../lib/logger.js';
import Review from '../models/Review.js';
import ReviewReplySettings from '../models/ReviewReplySettings.js';

const logger = createLogger('ReviewReplyService');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 리뷰 답변 생성을 위한 기본 프롬프트 생성
 * @param {Object} businessInfo - 업체 정보
 * @param {Object} replySettings - 답변 설정
 * @returns {string} 시스템 프롬프트
 */
function createSystemPrompt(businessInfo, replySettings) {
  let basePrompt = `당신은 ${businessInfo.place_name}의 사업자로서 고객 리뷰에 정중하고 따뜻한 답변을 작성하는 역할을 합니다.

## 기본 업체 정보
- 업체명: ${businessInfo.place_name}
- 업체 주소: ${businessInfo.address || '정보 없음'}
- 업체 카테고리: ${businessInfo.category || '정보 없음'}

## 답변 작성 지침
1. 항상 정중하고 감사의 마음을 표현하세요
2. 고객의 방문과 리뷰에 대해 진심으로 감사드린다는 내용을 포함하세요
3. 구체적인 칭찬이나 피드백에 대해서는 개별적으로 언급하세요
4. 문제점이나 불만사항이 있다면 진정성 있게 사과하고 개선 의지를 표현하세요
5. 재방문을 유도하는 따뜻한 메시지로 마무리하세요
6. 답변 길이는 2-4문장으로 간결하면서도 진정성 있게 작성하세요
7. 과도한 마케팅성 멘트는 피하고, 자연스러운 대화체를 사용하세요`;

  // 추가 설정이 있으면 반영
  if (replySettings) {
    if (replySettings.tone) {
      basePrompt += `\n\n## 답변 톤 앤 매너\n- ${replySettings.tone}`;
    }
    
    // key_messages 또는 keyMessages 모두 지원
    const keyMessages = replySettings.key_messages || replySettings.keyMessages;
    if (keyMessages && keyMessages.length > 0) {
      basePrompt += `\n\n## 포함해야 할 핵심 메시지\n${keyMessages.map(msg => `- ${msg}`).join('\n')}`;
      basePrompt += `\n※ 위 핵심 메시지를 답변에 자연스럽게 포함시켜 주세요.`;
    }
    
    // avoid_words 또는 avoidWords 모두 지원
    const avoidWords = replySettings.avoid_words || replySettings.avoidWords;
    if (avoidWords && avoidWords.length > 0) {
      basePrompt += `\n\n## 사용하지 말아야 할 표현\n${avoidWords.map(word => `- ${word}`).join('\n')}`;
      basePrompt += `\n※ 위 표현들은 절대 사용하지 말아주세요.`;
    }
  }

  basePrompt += `\n\n## 답변 형식
답변은 반드시 JSON 형식으로만 제공하세요:
{
  "reply": "생성된 답변 내용"
}`;

  return basePrompt;
}

/**
 * 리뷰 분석을 위한 사용자 프롬프트 생성
 * @param {Object} review - 리뷰 정보
 * @param {Object} replySettings - 답변 설정 (핵심 메시지 강조용)
 * @returns {string} 사용자 프롬프트
 */
function createUserPrompt(review, replySettings = null) {
  let prompt = `다음 고객 리뷰에 대한 사업자 답변을 작성해주세요:

## 리뷰 정보
- 작성자: ${review.author || '익명'}
- 작성일: ${new Date(review.review_date).toLocaleDateString('ko-KR')}`;

  if (review.title) {
    prompt += `\n- 제목: ${review.title}`;
  }

  if (review.content) {
    prompt += `\n- 내용: ${review.content}`;
  } else {
    prompt += `\n- 내용: (영수증 리뷰 - 텍스트 내용 없음)`;
  }

  if (review.images && review.images.length > 0) {
    prompt += `\n- 이미지 첨부: ${review.images.length}장`;
  }

  // 핵심 메시지가 있으면 강조
  if (replySettings) {
    const keyMessages = replySettings.key_messages || replySettings.keyMessages;
    if (keyMessages && keyMessages.length > 0) {
      prompt += `\n\n**중요**: 다음 핵심 메시지를 답변에 반드시 자연스럽게 포함시켜야 합니다:`;
      keyMessages.forEach(msg => {
        prompt += `\n- "${msg}"`;
      });
    }
  }

  prompt += `\n\n위 리뷰에 대한 적절한 사업자 답변을 JSON 형식으로 생성해주세요.`;

  return prompt;
}

/**
 * ChatGPT를 사용하여 단일 리뷰에 대한 답변 생성
 * @param {Object} review - 리뷰 정보
 * @param {Object} businessInfo - 업체 정보
 * @param {Object} replySettings - 답변 설정
 * @returns {Promise<string>} 생성된 답변
 */
export async function generateSingleReply(review, businessInfo, replySettings = null) {
  try {
    const systemPrompt = createSystemPrompt(businessInfo, replySettings);
    const userPrompt = createUserPrompt(review, replySettings);

    logger.info(`리뷰 ID ${review.id}에 대한 답변 생성 시작`);
    
    // 핵심 메시지가 있으면 로그로 확인
    if (replySettings) {
      const keyMessages = replySettings.key_messages || replySettings.keyMessages;
      if (keyMessages && keyMessages.length > 0) {
        logger.info(`핵심 메시지 적용: ${JSON.stringify(keyMessages)}`);
      }
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const answer = response.choices?.[0]?.message?.content?.trim() || '';
    
    // JSON 형식에서 답변 추출
    try {
      const jsonMatch = answer.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, answer];
      const rawJson = jsonMatch[1].trim();
      const parsed = JSON.parse(rawJson);
      
      if (parsed.reply) {
        logger.info(`리뷰 ID ${review.id} 답변 생성 완료`);
        return parsed.reply;
      } else {
        throw new Error('답변 필드가 없습니다.');
      }
    } catch (parseError) {
      logger.warn('JSON 파싱 실패, 전체 응답을 답변으로 사용:', parseError.message);
      return answer;
    }

  } catch (error) {
    logger.error(`리뷰 ID ${review.id} 답변 생성 실패:`, error.message);
    throw error;
  }
}

/**
 * 여러 리뷰에 대한 답변을 일괄 생성
 * @param {string} placeId - 플레이스 ID
 * @param {Object} options - 옵션
 * @returns {Promise<Object>} 생성 결과
 */
export async function generateRepliesForPlace(placeId, options = {}) {
  try {
    logger.info(`플레이스 ${placeId}의 리뷰 답변 일괄 생성 시작`);

    // 1. 플레이스 ID 검증 (리뷰가 있는지 확인)
    const existingReview = await Review.findOne({
      where: { place_id: placeId }
    });

    if (!existingReview) {
      throw new Error('해당 플레이스의 리뷰를 찾을 수 없습니다.');
    }

    // 2. 답변 설정 조회 (있다면)
    let replySettings = null;
    if (options.useSettings) {
      replySettings = await ReviewReplySettings.findOne({
        where: { place_id: placeId }
      });
    }

    // 3. 기본 업체 정보 생성 (placeId 기반)
    const businessInfo = {
      place_name: `Business_${placeId}`,
      address: '정보 없음',
      category: '정보 없음'
    };

    // 4. 답변이 없는 리뷰 조회
    const reviews = await Review.findAll({
      where: {
        place_id: placeId,
        reply: null,
        ...(options.reviewType && { review_type: options.reviewType })
      },
      order: [['review_date', 'DESC']],
      limit: options.limit || 50 // 한 번에 최대 50개
    });

    if (reviews.length === 0) {
      return {
        success: true,
        message: '답변할 리뷰가 없습니다.',
        summary: { success: 0, failure: 0, total: 0 }
      };
    }

    logger.info(`총 ${reviews.length}개의 리뷰에 대한 답변 생성 시작`);

    const results = {
      success: 0,
      failure: 0,
      total: reviews.length,
      errors: []
    };

    // 5. 각 리뷰에 대해 답변 생성 및 저장
    for (const review of reviews) {
      try {
        const generatedReply = await generateSingleReply(
          review, 
          businessInfo, 
          replySettings
        );

        // 답변 저장
        await review.update({
          reply: generatedReply,
          reply_date: new Date(),
          reply_generated_by_ai: true,
          reply_status: 'draft',
          ai_generation_settings: replySettings ? {
            tone: replySettings.tone,
            keyMessages: replySettings.key_messages,
            avoidWords: replySettings.avoid_words
          } : null,
          has_owner_reply: true
        });

        results.success++;
        logger.info(`리뷰 ID ${review.id} 답변 저장 완료`);

        // API 요청 간격 조절 (OpenAI 제한 고려)
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        results.failure++;
        results.errors.push({
          reviewId: review.id,
          error: error.message
        });
        logger.error(`리뷰 ID ${review.id} 답변 생성/저장 실패:`, error.message);
      }
    }

    logger.info(`답변 생성 완료 - 성공: ${results.success}, 실패: ${results.failure}`);

    return {
      success: true,
      message: `총 ${results.total}개 리뷰 중 ${results.success}개 답변 생성 완료`,
      summary: {
        success: results.success,
        failure: results.failure,
        total: results.total
      },
      errors: results.errors
    };

  } catch (error) {
    logger.error('답변 일괄 생성 실패:', error.message);
    throw error;
  }
}

/**
 * 답변 설정 조회
 * @param {string} placeId - 플레이스 ID
 * @returns {Promise<Object>} 답변 설정
 */
export async function getReplySettings(placeId) {
  try {
    const settings = await ReviewReplySettings.findOne({
      where: { place_id: placeId }
    });
    
    if (settings) {
      const settingsData = settings.toJSON();
      logger.info(`답변 설정 조회 성공 - placeId: ${placeId}`, {
        tone: settingsData.tone,
        keyMessages: settingsData.key_messages,
        avoidWords: settingsData.avoid_words
      });
      return settingsData;
    } else {
      logger.info(`답변 설정 없음 - placeId: ${placeId}`);
      return null;
    }
  } catch (error) {
    logger.error('답변 설정 조회 실패:', error.message);
    throw error;
  }
}

/**
 * 답변 설정 저장/업데이트
 * @param {string} placeId - 플레이스 ID
 * @param {Object} settings - 답변 설정
 * @returns {Promise<Object>} 저장된 설정
 */
export async function saveReplySettings(placeId, settings, userId) {
  try {
    const [replySettings, created] = await ReviewReplySettings.upsert({
      user_id: userId,
      place_id: placeId,
      tone: settings.tone,
      key_messages: settings.key_messages,
      avoid_words: settings.avoid_words,
      template_content: settings.template_content
    });

    logger.info(`플레이스 ${placeId}의 답변 설정 ${created ? '생성' : '업데이트'} 완료`);
    
    return replySettings;
  } catch (error) {
    logger.error('답변 설정 저장 실패:', error.message);
    throw error;
  }
}
