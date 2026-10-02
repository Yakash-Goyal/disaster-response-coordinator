"""JWT authentication and role-based access control (spec section 6, Auth)."""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Query, WebSocket, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import settings
from .database import SessionLocal, get_db
from .models import Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

_PBKDF_ROUNDS = 120_000


# --------------------------------------------------------------------------
# Passwords — PBKDF2-HMAC-SHA256, no external dependency required.
# --------------------------------------------------------------------------
def hash_password(password: str, *, salt: bytes | None = None) -> str:
    salt = salt or hashlib.sha256(password.encode() + settings.SECRET_KEY.encode()).digest()[:16]
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF_ROUNDS)
    return f"pbkdf2${_PBKDF_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


# --------------------------------------------------------------------------
# Tokens
# --------------------------------------------------------------------------
def create_access_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.TOKEN_TTL_MINUTES)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "resource_id": user.resource_id,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Sign in again — your session is not valid.",
    headers={"WWW-Authenticate": "Bearer"},
)


def current_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    if not token:
        raise CREDENTIALS_ERROR
    try:
        payload = decode_token(token)
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise CREDENTIALS_ERROR
    user = db.get(User, user_id)
    if user is None:
        raise CREDENTIALS_ERROR
    return user


def require_roles(*roles: str):
    allowed = set(roles)

    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action needs one of these roles: {', '.join(sorted(allowed))}.",
            )
        return user

    return dependency


require_commander = require_roles(Role.COMMANDER.value, Role.ADMIN.value)
require_admin = require_roles(Role.ADMIN.value)
require_any = require_roles(Role.COMMANDER.value, Role.ADMIN.value, Role.RESPONDER.value)


async def websocket_user(websocket: WebSocket, token: str | None = Query(default=None)) -> User:
    """WebSockets cannot carry Authorization headers from the browser, so the
    token arrives as a query parameter."""
    if not token:
        await websocket.close(code=4401)
        raise CREDENTIALS_ERROR
    db = SessionLocal()
    try:
        payload = decode_token(token)
        user = db.get(User, int(payload["sub"]))
        if user is None:
            raise ValueError
        db.expunge(user)
        return user
    except Exception:
        await websocket.close(code=4401)
        raise CREDENTIALS_ERROR
    finally:
        db.close()
