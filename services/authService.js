import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { redisClient } from '../config/redisClient.js';

export function createAccessToken(userId) {
  return jwt.sign({ userId }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
}

export function createRefreshToken(userId) {
  return jwt.sign({ userId }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
}

export async function issueTokens(userId) {
  const accessToken = createAccessToken(userId);
  const refreshToken = createRefreshToken(userId);
  await User.saveRefreshToken(userId, refreshToken);
  return { accessToken, refreshToken };
}

export async function refreshTokens(refreshToken) {
  // TODO: implement logic: verify, check DB, issue new tokens
  throw new Error('refreshTokens not implemented');
}

export async function signupLocal(email, password) {
  // TODO: implement: hash password, create user
  throw new Error('signupLocal not implemented');
}

export async function verifyEmailCode(email, code) {
  // TODO: implement: check redis, create or find user
  throw new Error('verifyEmailCode not implemented');
}

export async function checkEmailAndPassword(email, password) {
  const user = await User.findOne({ where: { email } });
  if (!user) throw new Error('User not found');
  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new Error('Password mismatch');
  return user;
}

export async function logoutUser(userId) {
  // TODO: clear refresh token in DB
  throw new Error('logoutUser not implemented');
}
