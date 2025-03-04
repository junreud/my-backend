// db/userService.js
export async function getUserById(userId) {
    // 실제로는 DB에서 userId를 검색하여 유저 정보 리턴
    // 여기서는 하드코딩된 예시로 대체
    if (userId === 123) {
      return {
        id: 123,
        email: "test@example.com",
        name: "홍길동",
        // 비밀번호나 기타 민감 정보는 제외하거나 별도로 관리
      };
    } else {
      return null;
    }
  }