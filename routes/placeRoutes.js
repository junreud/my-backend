import express from 'express';
import { getUserPlaces, checkPlace, createPlace } from '../controllers/placeController.js';
import passport from 'passport';

const router = express.Router();

// JWT 인증 미들웨어
const authenticateJWT = passport.authenticate('jwt', { session: false });

// Get places associated with a user - should work with /api/place?userId=X
router.get('/', authenticateJWT, getUserPlaces);

// Check if place exists for user
router.post('/check', authenticateJWT, checkPlace);

// Create a new place
router.post('/create', authenticateJWT, createPlace);

export default router;
