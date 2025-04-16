import axios from 'axios';

export const addFriends = async (req, res) => {
  try {
    const response = await axios.post('http://localhost:5001/kakao/add-friends', {
      friends: req.body  // FastAPI가 기대하는 구조로 감싸기
    });    res.json({ success: true, result: response.data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

export const sendMessages = async (req, res) => {
  try {
    const response = await axios.post('http://localhost:5001/kakao/send-messages', req.body);
    res.json({ success: true, result: response.data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};