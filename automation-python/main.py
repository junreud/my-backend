# flake8: noqa
# uvicorn main:app --host 0.0.0.0 --reload --port 5001

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Literal  # typing에서 List와 Literal 임포트

# 분리된 모듈에서 함수 임포트
from friend_manager import add_friends_via_kakao
from message_sender import send_messages_via_kakao

app = FastAPI()

# --- Pydantic 모델 정의 ---


class Friend(BaseModel):
    username: str
    phone: str


class AddFriendsRequest(BaseModel):
    friends: List[Friend]


class MessageItem(BaseModel):
    type: Literal["text", "image"]
    content: str


class SendMessageGroup(BaseModel):  # 클래스 이름 변경 (API 요청 구조와 일치)
    username: str
    messages: List[MessageItem]


class SendMessagesRequest(BaseModel):
    message_groups: List[SendMessageGroup]  # SendMessageGroup 사용

# --- API 엔드포인트 ---


@app.post("/kakao/add-friends")
def add_friends(request: AddFriendsRequest):
    """
    카카오톡 친구 추가 API 엔드포인트
    """
    try:
        # Pydantic 모델을 사용하여 받은 데이터를 Python dict 리스트로 변환
        friends_data = [friend.dict() for friend in request.friends]
        # DEBUG: 로그로 받은 친구 목록 출력
        print(f"DEBUG main.add_friends received friends_data: {friends_data}")
        results = add_friends_via_kakao(friends_data)
        return {"results": results}
    except Exception as e:
        # 오류 발생 시 500 에러와 함께 상세 내용 반환
        raise HTTPException(status_code=500, detail=f"친구 추가 중 오류 발생: {str(e)}")


@app.post("/kakao/send-messages")
def send_messages(request: SendMessagesRequest):
    """
    카카오톡 메시지(텍스트/이미지) 전송 API 엔드포인트
    """
    try:
        # Pydantic 모델을 사용하여 받은 데이터를 Python dict 리스트로 변환
        message_groups_data = [group.dict() for group in request.message_groups]
        results = send_messages_via_kakao(message_groups_data)
        return {"results": results}
    except Exception as e:
        # 오류 발생 시 500 에러와 함께 상세 내용 반환
        raise HTTPException(status_code=500, detail=f"메시지 전송 중 오류 발생: {str(e)}")
