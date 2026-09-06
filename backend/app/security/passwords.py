from pwdlib import PasswordHash
from pwdlib.exceptions import PwdlibError


password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    try:
        return password_hash.verify(password, encoded)
    except PwdlibError:
        return False
