from __future__ import annotations

from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from hashlib import scrypt
import hmac
import secrets

import jwt

from app.core.config import settings

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 64
JWT_ALGORITHM = "HS256"
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128


def _encode_bytes(value: bytes) -> str:
    return urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode_bytes(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_DKLEN,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_encode_bytes(salt)}${_encode_bytes(digest)}"


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False

    try:
        scheme, n_value, r_value, p_value, salt_value, digest_value = password_hash.split("$")
    except ValueError:
        return False

    if scheme != "scrypt":
        return False

    derived = scrypt(
        password.encode("utf-8"),
        salt=_decode_bytes(salt_value),
        n=int(n_value),
        r=int(r_value),
        p=int(p_value),
        dklen=len(_decode_bytes(digest_value)),
    )
    return hmac.compare_digest(derived, _decode_bytes(digest_value))


def validate_password_strength(password: str) -> None:
    normalized = password.strip()
    if len(normalized) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {PASSWORD_MIN_LENGTH} characters long.")
    if len(password) > PASSWORD_MAX_LENGTH:
        raise ValueError(f"Password must be no longer than {PASSWORD_MAX_LENGTH} characters.")


def generate_auth_token() -> str:
    return secrets.token_urlsafe(32)


def hash_auth_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def build_session_token(*, user_id: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.session_hours)).timestamp()),
        "iss": settings.app_name,
    }
    return jwt.encode(payload, settings.auth_secret_key, algorithm=JWT_ALGORITHM)


def decode_session_token(token: str) -> dict[str, object]:
    return jwt.decode(
        token,
        settings.auth_secret_key,
        algorithms=[JWT_ALGORITHM],
        issuer=settings.app_name,
    )
