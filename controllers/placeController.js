import Place from '../models/Place.js';
import PlaceDetailResult from '../models/PlaceDetailResult.js';
import { createLogger } from '../lib/logger.js';
import { createControllerHelper } from '../utils/controllerHelpers.js'; // Added

const logger = createLogger('PlaceController');
// const { sendSuccess, sendError, handleDbOperation, validateRequiredFields } = createControllerHelper('PlaceController'); // Removed

/**
 * Get all places associated with a user
 */
export const getUserPlaces = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({ controllerName: 'PlaceController', actionName: 'getUserPlaces' });
  try {
    const { userId } = req.query;
    
    const validationError = validateRequiredFields(req.query, ['userId']);
    if (validationError) {
      // Throw a custom error that can be handled by the router
      const error = new Error(validationError.message);
      error.statusCode = 400;
      throw error;
    }
    
    const places = await handleDbOperation(async () => {
      return Place.findAll({
        where: { user_id: userId },
        attributes: ['id', 'place_id', 'place_name', 'category', 'isNewlyOpened'],
        raw: true, // Get plain JSON objects
      });
    }, "사용자 장소 목록 조회(기본)");

    const formattedPlaces = await Promise.all(places.map(async (place) => {
      let blog_review_count = null;
      let receipt_review_count = null;
      try {
        const latestDetail = await PlaceDetailResult.findOne({
          where: { place_id: place.place_id },
          order: [['last_crawled_at', 'DESC']],
          attributes: ['blog_review_count', 'receipt_review_count'],
          raw: true, // Get plain JSON object
        });
        if (latestDetail) {
          blog_review_count = latestDetail.blog_review_count ?? null;
          receipt_review_count = latestDetail.receipt_review_count ?? null;
        }
      } catch (err) {
        controllerLogger.error(`Error fetching review counts for place_id ${place.place_id}:`, err);
      }
      return {
        id: place.id,
        place_id: place.place_id,
        place_name: place.place_name,
        category: place.category,
        isNewlyOpened: place.isNewlyOpened,
        blog_review_count,
        receipt_review_count,
        platform: 'naver',
      };
    }));
    
    return formattedPlaces; // Return data
  } catch (error) {
    controllerLogger.error('Error fetching user places:', error);
    throw error; // Rethrow error
  }
};

/**
 * Check if a place is already saved by the user
 */
export const checkPlace = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({ controllerName: 'PlaceController', actionName: 'checkPlace' });
  try {
    const { userId, place_id } = req.body; 
    
    const validationError = validateRequiredFields(req.body, ['userId', 'place_id']);
    if (validationError) {
      const error = new Error(validationError.message);
      error.statusCode = 400;
      throw error;
    }
    
    const place = await handleDbOperation(async () => {
      return Place.findOne({
        where: { 
          user_id: userId,
          place_id: place_id
        },
        raw: true, // Get plain JSON object
      });
    }, "장소 중복 확인");
    
    if (place) {
      return { // Return data
        exists: true,
        place: {
          ...place, // Spread raw object
          platform: 'naver'
        }
      };
    } else {
      return { exists: false }; // Return data
    }
  } catch (error) {
    controllerLogger.error('Error checking place:', error);
    throw error; // Rethrow error
  }
};

/**
 * Create a new place
 */
export const createPlace = async (req) => {
  const { handleDbOperation, validateRequiredFields, logger: controllerLogger } = createControllerHelper({ controllerName: 'PlaceController', actionName: 'createPlace' });
  try {
    const { userId, place_name, category, url } = req.body;
    
    const validationError = validateRequiredFields(req.body, ['userId', 'place_name', 'url']);
    if (validationError) {
      const error = new Error(validationError.message);
      error.statusCode = 400;
      throw error;
    }
    
    let place_id_extracted; // Renamed to avoid conflict with place_id from model
    const match = url.match(/https?:\/\/(m\.)?place\.naver\.com\/(restaurant|place)\/(\d+)/);
    if (!match) {
      const error = new Error('Invalid Naver place URL');
      error.statusCode = 400;
      throw error;
    }
    place_id_extracted = match[3];
    
    const newPlace = await handleDbOperation(async () => { // Renamed place to newPlace
      return Place.create({
        place_id: place_id_extracted, // Use extracted value
        place_name,
        category,
        user_id: userId,
        isNewlyOpened: false
      });
    }, "신규 장소 생성");
    
    return { // Return data
      place: {
        ...(newPlace.toJSON()), // Ensure plain object
        platform: 'naver'
      }
    };
  } catch (error) {
    controllerLogger.error('Error creating place:', error);
    throw error; // Rethrow error
  }
};
