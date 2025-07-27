// services/tesseractAdDetector.js
import 'dotenv/config';
import Tesseract from 'tesseract.js';
import { createLogger } from '../lib/logger.js';
import { analyzeTextForAdKeywords } from './ocrAdDetector.js';

const logger = createLogger('TesseractAdDetector');

/**
 * Tesseract.js를 사용하여 이미지에서 텍스트 추출 및 광고 분석
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<Object>} 분석 결과
 */
export async function analyzeImageForAdWithTesseract(imageUrl) {
  try {
    logger.info(`🔍 Tesseract OCR 이미지 분석 시작: ${imageUrl.substring(0, 60)}...`);

    // Tesseract.js로 텍스트 추출
    const { data } = await Tesseract.recognize(imageUrl, 'kor+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          logger.info(`OCR 진행률: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    const extractedText = data.text.trim();
    logger.info(`📝 추출된 텍스트 (${extractedText.length}자): "${extractedText.substring(0, 100)}..."`);

    // 추출된 텍스트에서 광고 키워드 분석
    const adAnalysis = analyzeTextForAdKeywords(extractedText);

    // 텍스트 블록 정보 수집
    const textBlocks = data.words
      .filter(word => word.confidence > 60) // 신뢰도 60% 이상만
      .map(word => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox
      }));

    const result = {
      success: true,
      isAd: adAnalysis.isAd,
      confidence: adAnalysis.confidence,
      detectedKeywords: adAnalysis.detectedKeywords,
      reason: adAnalysis.reason,
      analysisDetails: {
        text: {
          fullText: extractedText,
          adKeywords: adAnalysis.detectedKeywords,
          adScore: adAnalysis.score,
          adConfidence: adAnalysis.confidence
        },
        ocr: {
          extractedText,
          textBlocks,
          totalWords: data.words.length,
          averageConfidence: data.words.reduce((sum, w) => sum + w.confidence, 0) / data.words.length
        }
      }
    };

    logger.info(`✅ Tesseract OCR 분석 완료:`);
    logger.info(`- 추출된 텍스트: "${extractedText.substring(0, 50)}..."`);
    logger.info(`- 단어 수: ${data.words.length}개`);
    logger.info(`- 평균 신뢰도: ${result.analysisDetails.ocr.averageConfidence.toFixed(1)}%`);
    logger.info(`- 광고 여부: ${result.isAd ? '광고' : '일반'}`);
    logger.info(`- 광고 신뢰도: ${result.confidence}%`);
    logger.info(`- 발견된 키워드: [${result.detectedKeywords.join(', ')}]`);
    logger.info(`- 판단 근거: ${result.reason}`);

    return result;

  } catch (error) {
    logger.error(`❌ Tesseract OCR 분석 실패: ${error.message}`);
    return {
      success: false,
      isAd: false,
      confidence: 0,
      error: error.message,
      reason: 'OCR 분석 중 오류 발생'
    };
  }
}

/**
 * 빠른 텍스트 추출 (광고 분석 없이)
 * @param {string} imageUrl - 이미지 URL
 * @returns {Promise<Object>} 텍스트 추출 결과
 */
export async function extractTextWithTesseract(imageUrl) {
  try {
    logger.info(`📝 Tesseract 텍스트 추출: ${imageUrl.substring(0, 60)}...`);

    const { data } = await Tesseract.recognize(imageUrl, 'kor+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && m.progress % 0.2 === 0) {
          logger.info(`텍스트 추출 진행률: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    return {
      success: true,
      text: data.text.trim(),
      words: data.words.length,
      confidence: data.words.reduce((sum, w) => sum + w.confidence, 0) / data.words.length
    };

  } catch (error) {
    logger.error(`❌ 텍스트 추출 실패: ${error.message}`);
    return {
      success: false,
      text: '',
      words: 0,
      confidence: 0,
      error: error.message
    };
  }
}

export default {
  analyzeImageForAdWithTesseract,
  extractTextWithTesseract
};
