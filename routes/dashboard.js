const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/data', async (req, res) => {
  try {
    // 예시: 테이블 'marketing_progress'의 모든 데이터를 조회
    const [rows] = await pool.query('SELECT * FROM marketing_progress');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;