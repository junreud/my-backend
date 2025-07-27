// 표준화된 API 응답 헬퍼

export const sendSuccess = (res, data = {}, message = '', status = 200) => {
  return res.status(status).json({ success: true, message, data });
};

export const sendError = (res, status = 500, message = '', errors = null) => {
  const payload = { success: false, message };
  if (errors) payload.errors = errors;
  return res.status(status).json(payload);
};
