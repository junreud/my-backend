import 'dotenv/config';
import AWS from 'aws-sdk';

AWS.config.update({
  region: process.env.AWS_REGION,
  credentials: new AWS.Credentials({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  }),
});

const ses = new AWS.SES({ apiVersion: "2010-12-01" });

/**
 * 이메일 인증번호 전송 (HTML 형식)
 * @param {string} toEmail 수신자 이메일
 * @param {string} code 인증코드
 */
export async function sendVerificationCode(toEmail, code) {
  // 제목에 인증번호 포함
  const subjectLine = `라카비 코드는 ${code}입니다`;

  // HTML 본문 예시 (원하는 대로 꾸미세요)
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>인증번호 안내</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background-color:#ffffff;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <h1 style="margin-bottom:16px;">OpenAI</h1>
    <p style="font-size:16px;margin-bottom:24px;">
      다음 임시 인증 코드를 입력해 계속하세요:
    </p>
    <div style="font-size:32px;font-weight:bold;background-color:#f0f0f0;padding:16px;border-radius:8px;display:inline-block;">
      ${code}
    </div>
    <p style="font-size:14px;margin-top:24px;">
      라카비 계정을 생성하고자 하는 것이 본인이 아닌 경우 이 이메일을 무시하세요.
    </p>
    <p style="margin-top:40px;font-size:14px;color:#888;">
      감사합니다.<br/>LAKABE 팀 드림
    </p>
    <hr style="margin:32px 0;border:none;border-top:1px solid #ccc;" />
    <div style="font-size:12px;color:#999;">
      <p>© 2025 LAKABE. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

  // 보내는 사람 (SES verified)
  const fromEmail = process.env.VERIFIED_EMAIL;

  const params = {
    Source: fromEmail,
    Destination: {
      ToAddresses: [toEmail],
    },
    Message: {
      Subject: {
        Data: subjectLine,
        Charset: "UTF-8",
      },
      Body: {
        Html: {
          Data: htmlContent,
          Charset: "UTF-8",
        },
        // 필요하다면 텍스트 버전도 함께 첨부
        // Text: {
        //   Data: `다음 인증번호를 입력해 계속하세요: ${code}\n\nChatGPT 계정을...`,
        //   Charset: "UTF-8",
        // },
      },
    },
  };

  try {
    await ses.sendEmail(params).promise();
    console.log(`이메일 전송 성공: ${toEmail}`);
  } catch (error) {
    console.error(`이메일 전송 실패: ${error}`);
    throw error;
  }
}
