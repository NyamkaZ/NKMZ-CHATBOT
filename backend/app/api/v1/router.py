from fastapi import APIRouter
from app.api.v1.endpoints import auth, chats, stream, admin, messenger, documents, payments

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(chats.router)
api_router.include_router(stream.router)
api_router.include_router(admin.router)
api_router.include_router(messenger.router)
api_router.include_router(documents.router)
api_router.include_router(payments.router)
