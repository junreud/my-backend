# uvicorn main:app --host 0.0.0.0 --reload --port 5001

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from automation import add_friends_via_kakao

app = FastAPI()


class Friend(BaseModel):
    username: str
    phone: str


class AddFriendsRequest(BaseModel):
    friends: List[Friend]


class MessageData(BaseModel):
    username: str
    message: str


@app.post("/kakao/add-friends")
def add_friends(request: AddFriendsRequest):
    """
    카카오톡 친구 추가 API 엔드포인트
    """
    friends_data = [
        {"username": friend.username, "phone": friend.phone}
        for friend in request.friends
    ]
    results = add_friends_via_kakao(friends_data)
    return {"results": results}


# @app.post("/kakao/send-messages")
# def send_messages(data: List[MessageData]):
#     """
#     카카오톡 메시지 전송 API 엔드포인트
#     """
#     try:
#         return send_messages_via_kakao([d.dict() for d in data])
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))
