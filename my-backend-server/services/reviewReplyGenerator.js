import OpenAI from 'openai';
import { createLogger } from '../lib/logger.js';
import ReviewReply from '../models/ReviewReply.js';
import dotenv from 'dotenv';

dotenv.config();

const logger = createLogger('ReviewReplyGenerator');

class ReviewReplyGenerator {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * 리뷰 답변 자동 생성
   */
  async generateReply(reviewContent, businessName, options = {}) {
    try {
      const {
        tone = 'friendly', // friendly, professional, warm, casual
        keywords = [], // 강조할 키워드 배열
        templateStyle = 'standard' // standard, detailed, brief
      } = options;

      // 랜덤하게 키워드 선택 (다양성을 위해)
      const selectedKeywords = this.selectRandomKeywords(keywords, 2);
      
      const prompt = this.buildPrompt(reviewContent, businessName, tone, selectedKeywords, templateStyle);
      
      logger.info('OpenAI API 요청 시작', { 
        businessName, 
        tone, 
        selectedKeywords,
        templateStyle 
      });

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.7, // 창의성을 위해 약간의 변동성 추가
      });

      const generatedReply = response.choices[0].message.content.trim();
      
      logger.info('답변 생성 완료', { 
        originalLength: reviewContent.length,
        replyLength: generatedReply.length 
      });

      return {
        success: true,
        reply: generatedReply,
        usedKeywords: selectedKeywords,
        tone,
        templateStyle
      };

    } catch (error) {
      logger.error('답변 생성 실패:', error);
      return {
        success: false,
        error: error.message,
        reply: null
      };
    }
  }

  /**
   * 시스템 프롬프트 정의
   */
  getSystemPrompt() {
    return `당신은 네이버 플레이스 영수증 리뷰에 대한 사업자 답변을 생성하는 전문가입니다.

다음 규칙을 따라 답변을 작성해주세요:
1. 고객의 방문에 대한 감사 표현
2. 리뷰 내용에 대한 구체적이고 개인화된 응답
3. 업체의 강점이나 특징 자연스럽게 언급
4. 재방문 유도 메시지
5. 친근하고 진정성 있는 톤
6. 100-200자 내외의 적절한 길이
7. 이모지 적절히 활용 (과도하지 않게)
8. 리뷰어를 '회원님' 또는 '고객님'으로 지칭

절대 하지 말 것:
- 거짓 정보나 과장된 표현
- 부정적인 내용에 대한 변명이나 핑계
- 다른 업체와의 비교
- 광고성 문구`;
  }

  /**
   * 사용자 프롬프트 생성
   */
  buildPrompt(reviewContent, businessName, tone, keywords, templateStyle) {
    const toneDescriptions = {
      friendly: '친근하고 따뜻한',
      professional: '전문적이고 정중한',
      warm: '따뜻하고 정감 있는',
      casual: '편안하고 자연스러운'
    };

    const styleDescriptions = {
      standard: '표준적인 길이와 구조',
      detailed: '상세하고 구체적인 설명',
      brief: '간결하고 핵심적인 내용'
    };

    let prompt = `업체명: ${businessName}
리뷰 내용: "${reviewContent}"

위 리뷰에 대한 사업자 답변을 생성해주세요.

답변 톤: ${toneDescriptions[tone]}
답변 스타일: ${styleDescriptions[templateStyle]}`;

    if (keywords.length > 0) {
      prompt += `\n답변에 자연스럽게 포함해야 할 키워드: ${keywords.join(', ')}`;
    }

    prompt += `\n\n리뷰 내용을 분석하여 고객이 언급한 구체적인 부분(음식, 서비스, 분위기 등)에 대해 개인화된 응답을 작성해주세요.`;

    return prompt;
  }

  /**
   * 키워드 랜덤 선택 (다양성을 위해)
   */
  selectRandomKeywords(keywords, maxCount = 2) {
    if (keywords.length === 0) return [];
    
    const shuffled = [...keywords].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(maxCount, keywords.length));
  }

  /**
   * 다수의 리뷰에 대한 일괄 답변 생성 및 DB 저장
   */
  async generateBulkReplies(reviews, businessName, options = {}, userId) {
    const results = [];
    
    for (const review of reviews) {
      try {
        // 각 리뷰마다 약간의 지연을 추가하여 API 호출 제한 방지
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const result = await this.generateReply(
          review.content, 
          businessName, 
          options
        );
        
        if (result.success) {
          // DB에 답변 저장
          try {
            const savedReply = await ReviewReply.create({
              review_id: review.id,
              user_id: userId,
              place_id: review.place_id,
              generated_reply: result.reply,
              generation_settings: {
                tone: options.tone,
                keywords: options.keywords,
                templateStyle: options.templateStyle,
                selectedKeywords: result.selectedKeywords,
                businessName
              },
              status: 'generated'
            });
            
            logger.info(`답변 DB 저장 완료`, { 
              reviewId: review.id, 
              replyId: savedReply.id 
            });
            
            results.push({
              reviewId: review.id,
              replyId: savedReply.id,
              naver_review_id: review.naver_review_id,
              originalContent: review.content,
              ...result
            });
            
          } catch (dbError) {
            logger.error(`답변 DB 저장 실패:`, dbError);
            results.push({
              reviewId: review.id,
              naver_review_id: review.naver_review_id,
              originalContent: review.content,
              success: false,
              error: `DB 저장 실패: ${dbError.message}`,
              generatedReply: result.reply // 생성은 성공했지만 저장 실패
            });
          }
        } else {
          results.push({
            reviewId: review.id,
            naver_review_id: review.naver_review_id,
            originalContent: review.content,
            ...result
          });
        }
        
      } catch (error) {
        logger.error(`리뷰 ${review.id} 답변 생성 실패:`, error);
        results.push({
          reviewId: review.id,
          naver_review_id: review.naver_review_id,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * 답변 품질 검증
   */
  validateReply(reply, originalReview) {
    const issues = [];
    
    // 길이 체크
    if (reply.length < 20) {
      issues.push('답변이 너무 짧습니다');
    }
    if (reply.length > 500) {
      issues.push('답변이 너무 깁니다');
    }
    
    // 필수 요소 체크
    if (!reply.includes('감사') && !reply.includes('고마')) {
      issues.push('감사 표현이 없습니다');
    }
    
    if (!reply.includes('회원님') && !reply.includes('고객님')) {
      issues.push('고객 호칭이 없습니다');
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      score: Math.max(0, 100 - (issues.length * 25))
    };
  }
}

export default ReviewReplyGenerator;
