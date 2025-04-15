import { exec } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

export async function addKakaoFriends(req, res) {
  const userList = req.body.users; // [{name, phone}, ...]
  const scriptsDir = path.join(process.cwd(), 'scripts');
  const inputPath = path.join(scriptsDir, 'input.json');
  const outputPath = path.join(scriptsDir, 'output.json');

  writeFileSync(inputPath, JSON.stringify(userList, null, 2), 'utf8');

  exec(`"C:\\Program Files\\AutoHotkey\\AutoHotkey.exe" "${scriptsDir}\\automate_kakao.ahk"`, (err) => {
    if (err) {
      return res.status(500).json({ error: 'AHK 실행 오류', detail: err });
    }
    const results = JSON.parse(readFileSync(outputPath, 'utf8'));
    // DB 저장 등 추가 처리
    res.json({ results });
  });
}