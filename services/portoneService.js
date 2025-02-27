// services/portoneService.js
import axios from 'axios';
import 'dotenv/config';

const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;
const PORTONE_API_BASE_URL = 'https://api.portone.io';

function getAuthHeader() {
  return { Authorization: `PortOne ${PORTONE_API_SECRET}` };
}

async function createIdentityVerification(createPayload) {
  try {
    const response = await axios.post(
      `${PORTONE_API_BASE_URL}/identity-verifications`,
      createPayload,
      { headers: getAuthHeader() }
    );
    return response.data;
  } catch (error) {
    console.error(
      'PortOne Create IdentityVerification Error:',
      error.response?.data || error.message
    );
    throw new Error('Failed to create identity verification');
  }
}

async function getIdentityVerification(identityVerificationId) {
  try {
    const response = await axios.get(
      `${PORTONE_API_BASE_URL}/identity-verifications/${identityVerificationId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  } catch (error) {
    console.error(
      'PortOne Identity Verification GET Error:',
      error.response?.data || error.message
    );
    throw new Error('Failed to get identity verification');
  }
}

async function sendIdentityVerification(identityVerificationId, sendPayload) {
  try {
    const response = await axios.post(
      `${PORTONE_API_BASE_URL}/identity-verifications/${identityVerificationId}/send`,
      sendPayload,
      { headers: getAuthHeader() }
    );
    return response.data;
  } catch (error) {
    console.error(
      'PortOne Identity Verification Send Error:',
      error.response?.data || error.message
    );
    throw new Error('Failed to send identity verification');
  }
}

async function confirmIdentityVerification(identityVerificationId, confirmPayload) {
  try {
    const response = await axios.post(
      `${PORTONE_API_BASE_URL}/identity-verifications/${identityVerificationId}/confirm`,
      confirmPayload,
      { headers: getAuthHeader() }
    );
    return response.data;
  } catch (error) {
    console.error(
      'PortOne Identity Verification Confirm Error:',
      error.response?.data || error.message
    );
    throw new Error('Failed to confirm identity verification');
  }
}

async function resendIdentityVerification(identityVerificationId, storeId) {
  try {
    let url = `${PORTONE_API_BASE_URL}/identity-verifications/${identityVerificationId}/resend`;
    if (storeId) {
      url += `?storeId=${storeId}`;
    }
    const response = await axios.post(url, {}, { headers: getAuthHeader() });
    return response.data;
  } catch (error) {
    console.error(
      'PortOne Identity Verification Resend Error:',
      error.response?.data || error.message
    );
    throw new Error('Failed to resend identity verification');
  }
}

module.exports = {
  createIdentityVerification,
  getIdentityVerification,
  sendIdentityVerification,
  confirmIdentityVerification,
  resendIdentityVerification,
};
