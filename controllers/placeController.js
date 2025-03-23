import Place from '../models/Place.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('PlaceController');

/**
 * Get all places associated with a user
 */
export const getUserPlaces = async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Place 테이블에서 직접 user_id로 필터링하여 조회
    const places = await Place.findAll({
      where: { user_id: userId },
      attributes: ['id', 'place_id', 'place_name', 'category', 'isNewlyOpened']
    });
    
    // Add default platform value for frontend compatibility
    const formattedPlaces = places.map(place => ({
      ...place.toJSON(),
      platform: 'naver' // Default platform
    }));
    
    // Frontend expects array of places directly
    return res.status(200).json(formattedPlaces);
  } catch (error) {
    console.error('Error fetching user places:', error);
    return res.status(500).json({ error: 'Failed to fetch places' });
  }
};

/**
 * Check if a place is already saved by the user
 */
export const checkPlace = async (req, res) => {
  try {
    const { userId, place_id } = req.body;
    
    if (!userId || !place_id) {
      return res.status(400).json({ error: 'User ID and place ID are required' });
    }
    
    // Check if the place exists in the database for this user (platform removed)
    const place = await Place.findOne({
      where: { 
        user_id: userId,
        place_id: place_id
      }
    });
    
    if (place) {
      // Place exists for this user
      return res.status(200).json({ 
        exists: true,
        place: {
          ...place.toJSON(),
          platform: 'naver' // Default platform for frontend compatibility
        }
      });
    } else {
      // Place doesn't exist for this user
      return res.status(200).json({ 
        exists: false 
      });
    }
  } catch (error) {
    console.error('Error checking place:', error);
    return res.status(500).json({ error: 'Failed to check place' });
  }
};

/**
 * Create a new place
 */
export const createPlace = async (req, res) => {
  try {
    const { userId, place_name, category, url } = req.body;
    
    if (!userId || !place_name || !url) {
      return res.status(400).json({ error: 'User ID, place name, and URL are required' });
    }
    
    // Extract place_id from URL
    let place_id;
    // We'll assume Naver URLs only for now
    const match = url.match(/https?:\/\/(m\.)?place\.naver\.com\/(restaurant|place)\/(\d+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid Naver place URL' });
    }
    place_id = match[3];
    
    // Save place without platform and url fields
    const place = await Place.create({
      place_id,
      place_name,
      category,
      user_id: userId,
      isNewlyOpened: false
    });
    
    // Add platform for frontend compatibility
    return res.status(201).json({ 
      place: {
        ...place.toJSON(),
        platform: 'naver'
      }
    });
  } catch (error) {
    console.error('Error creating place:', error);
    return res.status(500).json({ error: 'Failed to create place' });
  }
};
