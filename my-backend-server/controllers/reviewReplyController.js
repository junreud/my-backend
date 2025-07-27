import { createLogger } from '../lib/logger.js';
import { createControllerHelper } from '../utils/controllerHelpers.js';
import Review from '../models/Review.js';
import ReviewReplySettings from '../models/ReviewReplySettings.js';
import Place from '../models/Place.js';
import { 
  generateRepliesForPlace, 
  generateSingleReply,
  getReplySettings as getReplySettingsService,
  saveReplySettings as saveReplySettingsService
} from '../services/reviewReplyService.js';
import CustomerInfo from '../models/CustomerInfo.js';
import { sendSuccess, sendError } from '../lib/response.js';

const logger = createLogger('ReviewReplyController');

/**
 * AI 답변 설정 조회
 */
const getReplySettings = async (req, res) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewReplyController', actionName: 'getReplySettings' });
  
  const { placeId } = req.params;
  const userId = req.user.id;
  
  controllerLogger.info('AI 답변 설정 조회 요청', { placeId, userId });
  
  const validationError = validateRequiredFields({ placeId, userId }, ['placeId', 'userId']);
  if (validationError) {
    controllerLogger.error('요청 파라미터 검증 실패', { placeId, userId, error: validationError.message });
    return res.status(400).json({
      success: false,
      message: validationError.message
    });
  }

  try {
    const result = await handleDbOperation(async () => {
      let settings = await ReviewReplySettings.findOne({
        where: { 
          user_id: userId,
          place_id: placeId
        }
      });

      // 설정이 없으면 기본값 반환
      if (!settings) {
        controllerLogger.info('설정이 없어 기본값 반환', { placeId, userId });
        return {
          tone: 'friendly',
          key_messages: [],
          avoid_words: [],
          template_content: '',
          auto_generate: false,
          is_active: true
        };
      }

      controllerLogger.info('기존 설정 반환', { placeId, userId, settings: settings.dataValues });
      return {
        tone: settings.tone,
        key_messages: settings.key_messages,
        avoid_words: settings.avoid_words,
        template_content: settings.template_content,
        auto_generate: settings.auto_generate,
        is_active: settings.is_active
      };
    }, "AI 답변 설정 조회");

    controllerLogger.info('AI 답변 설정 조회 성공', { placeId, userId, result });
    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('AI 답변 설정 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: 'AI 답변 설정 조회 중 오류가 발생했습니다.'
    });
  }
};

/**
 * AI 답변 설정 저장
 */
const saveReplySettings = async (req, res) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = 
    createControllerHelper({ controllerName: 'ReviewReplyController', actionName: 'saveReplySettings' });
  
  const { placeId } = req.params;
  const { tone, key_messages, avoid_words, template_content, auto_generate, business_name } = req.body;
  const userId = req.user.id;
  
  const validationError = validateRequiredFields({ placeId, userId }, ['placeId', 'userId']);
  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.message
    });
  }

  try {
    const result = await handleDbOperation(async () => {
      // Place 정보에서 business_name 가져오기
      let finalBusinessName = business_name;
      if (!finalBusinessName) {
        const place = await Place.findByPk(placeId);
        if (place) {
          finalBusinessName = place.business_name || place.name || '업체명';
        } else {
          finalBusinessName = '업체명'; // 기본값
        }
      }

      const [settings, created] = await ReviewReplySettings.findOrCreate({
        where: { 
          user_id: userId,
          place_id: placeId
        },
        defaults: {
          user_id: userId,
          place_id: placeId,
          business_name: finalBusinessName,
          tone: tone || 'friendly',
          key_messages: key_messages || [],
          avoid_words: avoid_words || [],
          template_content: template_content || '',
          auto_generate: auto_generate || false
        }
      });

      if (!created) {
        await settings.update({
          tone: tone || settings.tone,
          key_messages: key_messages !== undefined ? key_messages : settings.key_messages,
          avoid_words: avoid_words !== undefined ? avoid_words : settings.avoid_words,
          template_content: template_content !== undefined ? template_content : settings.template_content,
          auto_generate: auto_generate !== undefined ? auto_generate : settings.auto_generate,
          business_name: finalBusinessName || settings.business_name
        });
      }

      return {
        tone: settings.tone,
        key_messages: settings.key_messages,
        avoid_words: settings.avoid_words,
        template_content: settings.template_content,
        auto_generate: settings.auto_generate,
        is_active: settings.is_active
      };
    }, "AI 답변 설정 저장");

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    controllerLogger.error('AI 답변 설정 저장 오류:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'AI 답변 설정 저장 중 오류가 발생했습니다.'
    });
  }
};

/**
 * ChatGPT를 사용한 리뷰 답변 일괄 생성
 */
const generateAIReplies = async (req, res) => {
  try {
    const { placeId } = req.params;
    const { useSettings = true, reviewType = 'receipt', limit } = req.body;

    logger.info(`플레이스 ${placeId}의 AI 답변 생성 요청`);

    const result = await generateRepliesForPlace(placeId, {
      useSettings,
      reviewType,
      limit
    });

    return sendSuccess(res, result, 'AI 답변 생성이 완료되었습니다.');

  } catch (err) {
    logger.error('AI 답변 생성 실패:', err.message);
    return sendError(res, 500, err.message);
  }
};

/**
 * ChatGPT를 사용한 단일 리뷰 답변 생성
 */
const generateSingleAIReply = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { useSettings = true } = req.body;

    logger.info(`리뷰 ID ${reviewId}의 AI 답변 생성 요청`);

    // 리뷰 조회
    const review = await Review.findByPk(reviewId);
    if (!review) {
      return sendError(res, 404, '리뷰를 찾을 수 없습니다.');
    }

    // 업체 정보 조회
    const businessInfo = await CustomerInfo.findOne({
      where: { place_id: review.place_id }
    });

    if (!businessInfo) {
      return sendError(res, 404, '업체 정보를 찾을 수 없습니다.');
    }

    // 답변 설정 조회
    let replySettings = null;
    if (useSettings) {
      replySettings = await getReplySettingsService(review.place_id);
    }

    // 답변 생성
    const generatedReply = await generateSingleReply(review, businessInfo, replySettings);

    // 답변 저장
    await review.update({
      reply: generatedReply,
      reply_date: new Date(),
      reply_generated_by_ai: true,
      reply_status: 'draft',
      has_owner_reply: true
    });

    return sendSuccess(res, {
      reviewId: review.id,
      reply: generatedReply
    }, 'AI 답변이 생성되었습니다.');

  } catch (err) {
    logger.error('단일 AI 답변 생성 실패:', err.message);
    return sendError(res, 500, err.message);
  }
};

/**
 * 저장된 답변 설정 템플릿 목록 조회
 */
const getReplySettingsTemplates = async (req, res) => {
  try {
    const { placeId } = req.params;
    const userId = req.user.id;

    logger.info(`플레이스 ${placeId}의 답변 설정 템플릿 목록 조회`);

    const templates = await ReviewReplySettings.findAll({
      where: { 
        user_id: userId,
        place_id: placeId
      },
      attributes: ['id', 'template_name', 'tone', 'key_messages', 'avoid_words', 'template_content', 'created_at'],
      order: [['created_at', 'DESC']]
    });

    return sendSuccess(res, templates, '답변 설정 템플릿 목록을 조회했습니다.');

  } catch (err) {
    logger.error('답변 설정 템플릿 목록 조회 실패:', err.message);
    return sendError(res, 500, err.message);
  }
};

/**
 * 선택된 템플릿으로 즉시 답변 생성
 */
const generateReplyWithTemplate = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { templateId } = req.body;

    logger.info(`리뷰 ID ${reviewId}에 템플릿 ID ${templateId}로 답변 생성`);

    // 리뷰 조회
    const review = await Review.findByPk(reviewId);
    if (!review) {
      return sendError(res, 404, '리뷰를 찾을 수 없습니다.');
    }

    // 업체 정보 조회
    const businessInfo = await CustomerInfo.findOne({
      where: { place_id: review.place_id }
    });

    if (!businessInfo) {
      return sendError(res, 404, '업체 정보를 찾을 수 없습니다.');
    }

    // 선택된 템플릿 조회
    let replySettings = null;
    if (templateId) {
      replySettings = await ReviewReplySettings.findByPk(templateId);
      if (!replySettings) {
        return sendError(res, 404, '선택된 템플릿을 찾을 수 없습니다.');
      }
    }

    // 답변 생성
    const generatedReply = await generateSingleReply(review, businessInfo, replySettings);

    // 답변 저장
    await review.update({
      reply: generatedReply,
      reply_date: new Date(),
      reply_generated_by_ai: true,
      reply_status: 'draft',
      has_owner_reply: true,
      ai_generation_settings: templateId ? {
        template_id: templateId,
        template_name: replySettings.template_name,
        used_at: new Date()
      } : null
    });

    return sendSuccess(res, {
      reviewId: review.id,
      reply: generatedReply,
      templateUsed: replySettings ? {
        id: replySettings.id,
        name: replySettings.template_name
      } : null
    }, '선택된 템플릿으로 AI 답변이 생성되었습니다.');

  } catch (err) {
    logger.error('템플릿 기반 답변 생성 실패:', err.message);
    return sendError(res, 500, err.message);
  }
};

export {
  getReplySettings,
  saveReplySettings,
  generateAIReplies,
  generateSingleAIReply,
  getReplySettingsTemplates,
  generateReplyWithTemplate
};
