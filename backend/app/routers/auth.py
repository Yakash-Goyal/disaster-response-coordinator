from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import LoginRequest, TokenResponse, UserOut
from ..security import create_access_token, current_user, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

BAD_LOGIN = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="That username and password combination did not match an account.",
)


def _authenticate(db: Session, username: str, password: str) -> User:
    user = db.scalar(select(User).where(User.username == username.strip().lower()))
    if user is None or not verify_password(password, user.hashed_password):
        raise BAD_LOGIN
    return user


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = _authenticate(db, payload.username, payload.password)
    return TokenResponse(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.post("/token", response_model=TokenResponse)
def login_form(
    form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
) -> TokenResponse:
    """OAuth2 password flow — lets the interactive API docs authenticate."""
    user = _authenticate(db, form.username, form.password)
    return TokenResponse(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)
