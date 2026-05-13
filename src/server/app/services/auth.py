import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from authlib.integrations.httpx_client import AsyncOAuth2Client
from fastapi import HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import asc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.rbac import Role
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.models.invite import InviteToken
from app.models.org import Org, OrgMembership
from app.models.user import OAuthIdentity, RefreshToken, User
from app.core.config import settings
from app.core.logging import get_logger
from app.core.identity import jwt_roles_claim, jwt_user_type_claim, normalize_email, is_super_admin_user

logger = get_logger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
MICROSOFT_USERINFO_URL = "https://graph.microsoft.com/oidc/userinfo"
OAUTH_STATE_TOKEN_TYPE_PREFIX = "oauth_state"


def _oauth_redirect_uri() -> str:
    if settings.GOOGLE_REDIRECT_URI:
        return settings.GOOGLE_REDIRECT_URI
    return f"{settings.PUBLIC_APP_URL.rstrip('/')}/api/auth/google/callback"


def _microsoft_tenant() -> str:
    return (settings.MICROSOFT_TENANT or "common").strip().strip("/") or "common"


def _microsoft_authorization_url() -> str:
    return f"https://login.microsoftonline.com/{_microsoft_tenant()}/oauth2/v2.0/authorize"


def _microsoft_token_url() -> str:
    return f"https://login.microsoftonline.com/{_microsoft_tenant()}/oauth2/v2.0/token"


def _microsoft_redirect_uri() -> str:
    if settings.MICROSOFT_REDIRECT_URI:
        return settings.MICROSOFT_REDIRECT_URI
    return f"{settings.PUBLIC_APP_URL.rstrip('/')}/api/auth/microsoft/callback"


def _safe_return_url(return_url: str | None) -> str:
    value = (return_url or "").strip()
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/dashboard"
    return value


def _make_oauth_state(provider: str, return_url: str | None) -> str:
    return jwt.encode(
        {
            "typ": f"{OAUTH_STATE_TOKEN_TYPE_PREFIX}:{provider}",
            "return_url": _safe_return_url(return_url),
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def _decode_oauth_state(provider: str, state: str) -> str:
    try:
        payload = jwt.decode(state, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state") from exc

    if payload.get("typ") != f"{OAUTH_STATE_TOKEN_TYPE_PREFIX}:{provider}":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state")
    return _safe_return_url(payload.get("return_url"))


def make_google_authorization_url(return_url: str | None = None) -> str:
    """Build Google's authorization URL with a signed state payload."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured",
        )

    client = AsyncOAuth2Client(
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scope="openid email profile",
        redirect_uri=_oauth_redirect_uri(),
    )
    authorization_url, _state = client.create_authorization_url(
        GOOGLE_AUTH_URL,
        state=_make_oauth_state("google", return_url),
        prompt="select_account",
    )
    return authorization_url


def make_microsoft_authorization_url(return_url: str | None = None) -> str:
    """Build Microsoft authorization URL with a signed state payload."""
    if not settings.MICROSOFT_CLIENT_ID or not settings.MICROSOFT_CLIENT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Microsoft OAuth is not configured",
        )

    client = AsyncOAuth2Client(
        client_id=settings.MICROSOFT_CLIENT_ID,
        client_secret=settings.MICROSOFT_CLIENT_SECRET,
        scope="openid email profile",
        redirect_uri=_microsoft_redirect_uri(),
    )
    authorization_url, _state = client.create_authorization_url(
        _microsoft_authorization_url(),
        state=_make_oauth_state("microsoft", return_url),
        prompt="select_account",
    )
    return authorization_url


def decode_google_oauth_state(state: str) -> str:
    return _decode_oauth_state("google", state)


def decode_microsoft_oauth_state(state: str) -> str:
    return _decode_oauth_state("microsoft", state)


async def fetch_google_userinfo(code: str) -> dict:
    """Exchange an authorization code and fetch the Google profile."""
    async with AsyncOAuth2Client(
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scope="openid email profile",
        redirect_uri=_oauth_redirect_uri(),
    ) as client:
        try:
            await client.fetch_token(
                GOOGLE_TOKEN_URL,
                code=code,
                grant_type="authorization_code",
            )
        except Exception as exc:
            logger.warning("Google token exchange failed", error=str(exc))
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google sign-in failed")

        profile_res = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Accept": "application/json"},
        )
        if profile_res.status_code >= 400:
            logger.warning("Google userinfo fetch failed", status_code=profile_res.status_code)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google sign-in failed")
        return profile_res.json()


async def fetch_microsoft_userinfo(code: str) -> dict:
    """Exchange Microsoft authorization code and fetch OIDC userinfo."""
    async with AsyncOAuth2Client(
        client_id=settings.MICROSOFT_CLIENT_ID,
        client_secret=settings.MICROSOFT_CLIENT_SECRET,
        scope="openid email profile",
        redirect_uri=_microsoft_redirect_uri(),
    ) as client:
        try:
            await client.fetch_token(
                _microsoft_token_url(),
                code=code,
                grant_type="authorization_code",
                scope="openid email profile",
            )
        except Exception as exc:
            logger.warning("Microsoft token exchange failed", error=str(exc))
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Microsoft sign-in failed")

        profile_res = await client.get(
            MICROSOFT_USERINFO_URL,
            headers={"Accept": "application/json"},
        )
        if profile_res.status_code >= 400:
            logger.warning("Microsoft userinfo fetch failed", status_code=profile_res.status_code)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Microsoft sign-in failed")
        return profile_res.json()


async def _find_pending_invite(session: AsyncSession, email: str) -> InviteToken | None:
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(InviteToken)
        .where(
            InviteToken.email == normalize_email(email),
            InviteToken.used_at == None,  # noqa: E711
            InviteToken.expires_at >= now,
        )
        .order_by(asc(InviteToken.created_at))
    )
    return result.scalars().first()


async def _oldest_membership(session: AsyncSession, user_id: UUID) -> OrgMembership | None:
    result = await session.execute(
        select(OrgMembership)
        .where(OrgMembership.user_id == user_id)
        .order_by(asc(OrgMembership.created_at))
    )
    return result.scalars().first()


async def _login_with_oauth_profile(
    session: AsyncSession,
    *,
    provider: str,
    provider_user_id: str,
    email: str,
    name: str | None,
    missing_verified_detail: str,
    uninvited_detail: str,
) -> tuple[User, str, str]:
    from app.services.invite_service import (
        _assign_custom_role_if_any,
        _persist_scoped_refresh,
        invite_role_to_membership_role,
    )

    provider_user_id = str(provider_user_id or "")
    email = normalize_email(email or "")
    if not provider_user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=missing_verified_detail,
        )

    identity_result = await session.execute(
        select(OAuthIdentity).where(
            OAuthIdentity.provider == provider,
            OAuthIdentity.provider_user_id == provider_user_id,
        )
    )
    identity = identity_result.scalars().first()
    user = await session.get(User, identity.user_id) if identity else None
    if identity is not None and user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Linked user not found")

    if user is None:
        user_result = await session.execute(select(User).where(User.email == email))
        user = user_result.scalars().first()

    if user is None:
        invite = await _find_pending_invite(session, email)
        if invite is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=uninvited_detail,
            )

        org = await session.get(Org, invite.org_id)
        if not org:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invited organization not found")

        user = User(
            email=email,
            hashed_password=None,
            name=(name or "").strip() or None,
        )
        session.add(user)
        await session.flush()

        mem_role = invite_role_to_membership_role(invite.role)
        membership = OrgMembership(user_id=user.id, org_id=org.id, role=mem_role.value)
        session.add(membership)
        await _assign_custom_role_if_any(
            session,
            user_id=user.id,
            org_id=org.id,
            invite_role=invite.role,
        )
        invite.used_at = datetime.now(timezone.utc)
        session.add(invite)
        await session.flush()

    if identity is None:
        session.add(
            OAuthIdentity(
                user_id=user.id,
                provider=provider,
                provider_user_id=provider_user_id,
            )
        )

    membership = await _oldest_membership(session, user.id)
    if membership is None:
        invite = await _find_pending_invite(session, email)
        if invite is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User has no organization")
        org = await session.get(Org, invite.org_id)
        if not org:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invited organization not found")
        mem_role = invite_role_to_membership_role(invite.role)
        membership = OrgMembership(user_id=user.id, org_id=org.id, role=mem_role.value)
        session.add(membership)
        await _assign_custom_role_if_any(session, user_id=user.id, org_id=org.id, invite_role=invite.role)
        invite.used_at = datetime.now(timezone.utc)
        session.add(invite)
        await session.flush()

    org = await session.get(Org, membership.org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Organization not found")

    role = parse_membership_role(membership.role)
    access_token = _make_access_token(user, org, role)
    refresh_token = _persist_scoped_refresh(session, user.id, org.id)
    await session.flush()
    return user, access_token, refresh_token


async def login_with_google_profile(session: AsyncSession, profile: dict) -> tuple[User, str, str]:
    """
    Link or create an invited local user from a verified Google profile, then
    return the app's existing (user, access JWT, opaque refresh token) tuple.
    """
    provider_user_id = str(profile.get("sub") or "")
    email = normalize_email(str(profile.get("email") or ""))
    email_verified = profile.get("email_verified")
    is_verified = email_verified is True or str(email_verified).lower() == "true"
    if not is_verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account must have a verified email",
        )
    return await _login_with_oauth_profile(
        session,
        provider="google",
        provider_user_id=provider_user_id,
        email=email,
        name=str(profile.get("name") or ""),
        missing_verified_detail="Google account must have a verified email",
        uninvited_detail="Ask your organization administrator for an invite before signing in with Google.",
    )


async def login_with_microsoft_profile(session: AsyncSession, profile: dict) -> tuple[User, str, str]:
    """
    Link or create an invited local user from a Microsoft OIDC profile, then
    return the app's existing (user, access JWT, opaque refresh token) tuple.
    """
    provider_user_id = str(profile.get("sub") or "")
    email = normalize_email(
        str(
            profile.get("email")
            or profile.get("preferred_username")
            or profile.get("upn")
            or ""
        )
    )
    return await _login_with_oauth_profile(
        session,
        provider="microsoft",
        provider_user_id=provider_user_id,
        email=email,
        name=str(profile.get("name") or ""),
        missing_verified_detail="Microsoft account must include an email address",
        uninvited_detail="Ask your organization administrator for an invite before signing in with Microsoft.",
    )


def _slugify(name: str) -> str:
    """Convert a name to a URL-safe slug."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "org"


async def _ensure_unique_slug(session: AsyncSession, base_slug: str) -> str:
    """Ensure the org slug is unique by appending a counter if necessary."""
    slug = base_slug
    counter = 1
    while True:
        result = await session.execute(select(Org).where(Org.slug == slug))
        if result.scalars().first() is None:
            return slug
        slug = f"{base_slug}-{counter}"
        counter += 1


def jwt_effective_role(user: User, membership_role: Role) -> Role:
    """Elevate configured super admins to SUPER_ADMIN regardless of membership row."""
    if is_super_admin_user(user.id):
        return Role.SUPER_ADMIN
    return membership_role


def parse_membership_role(role_str: str) -> Role:
    """Map DB membership role string to JWT/base role; unknown custom roles fallback to USER."""
    try:
        return Role(role_str)
    except ValueError:
        return Role.USER


async def register_user(
    session: AsyncSession,
    email: str,
    password: str,
    name: str,
    organization_name: str | None = None,
) -> tuple[User, str, str]:
    """
    Register a new user, create their org, and return (user, access_token, refresh_token).
    One user -> one org for MVP.
    """
    # Check if email already exists
    email_norm = normalize_email(email)
    existing = await session.execute(select(User).where(User.email == email_norm))
    if existing.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Create user
    user = User(
        email=email_norm,
        hashed_password=hash_password(password),
        name=name,
    )
    session.add(user)
    await session.flush()  # Get user.id

    # Create org from user's name/email
    org_name = (organization_name or "").strip() or name or email_norm.split("@")[0]
    base_slug = _slugify(org_name)
    slug = await _ensure_unique_slug(session, base_slug)

    org = Org(name=org_name, slug=slug)
    session.add(org)
    await session.flush()  # Get org.id

    # Create membership
    membership = OrgMembership(
        user_id=user.id,
        org_id=org.id,
        role=Role.TENANT_ADMIN.value,
    )
    session.add(membership)
    await session.flush()

    # Create tokens
    access_token = _make_access_token(user, org, Role.TENANT_ADMIN)
    opaque_refresh, refresh_hash = create_refresh_token()

    refresh_token_obj = RefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        org_id=org.id,
        no_org_scope=False,
    )
    session.add(refresh_token_obj)

    logger.info("User registered", user_id=str(user.id), org_id=str(org.id))
    return user, access_token, opaque_refresh


async def login_user(
    session: AsyncSession,
    email: str,
    password: str,
) -> tuple[User, str, str]:
    """
    Authenticate a user and return (user, access_token, refresh_token).
    Raises 401 on invalid credentials.
    """
    result = await session.execute(select(User).where(User.email == normalize_email(email)))
    user = result.scalars().first()

    if not user or not user.hashed_password or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Get membership (deterministic: oldest membership first by created_at)
    membership_result = await session.execute(
        select(OrgMembership)
        .where(OrgMembership.user_id == user.id)
        .order_by(asc(OrgMembership.created_at))
    )
    membership = membership_result.scalars().first()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User has no organization",
        )

    org_result = await session.get(Org, membership.org_id)
    if not org_result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Organization not found",
        )

    role = parse_membership_role(membership.role)
    access_token = _make_access_token(user, org_result, role)
    opaque_refresh, refresh_hash = create_refresh_token()

    refresh_token_obj = RefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        org_id=org_result.id,
        no_org_scope=False,
    )
    session.add(refresh_token_obj)

    return user, access_token, opaque_refresh


async def refresh_tokens(
    session: AsyncSession,
    refresh_token: str,
) -> tuple[str, str]:
    """
    Rotate refresh tokens. Returns (new_access_token, new_refresh_token).
    Raises 401 if token is invalid or expired.
    """
    token_hash = hash_refresh_token(refresh_token)
    result = await session.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked == False,  # noqa: E712
        )
    )
    stored = result.scalars().first()

    if not stored:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked refresh token",
        )

    if stored.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        )

    # Revoke old token
    stored.revoked = True
    session.add(stored)
    await session.flush()

    user = await session.get(User, stored.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    persist_org_id: UUID | None = None
    persist_no_org = False

    if stored.no_org_scope:
        if not is_super_admin_user(user.id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token",
            )
        new_access = make_super_admin_reset_access_token(user)
        persist_org_id = None
        persist_no_org = True
    elif stored.org_id is not None:
        org = await session.get(Org, stored.org_id)
        if not org:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Org not found")
        is_sa = is_super_admin_user(user.id)
        mr = await session.execute(
            select(OrgMembership).where(
                OrgMembership.user_id == user.id,
                OrgMembership.org_id == stored.org_id,
            ),
        )
        membership = mr.scalars().first()
        if not membership and not is_sa:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No membership")
        jwt_role = Role.SUPER_ADMIN if is_sa else parse_membership_role(membership.role)
        new_access = _make_access_token(user, org, jwt_role)
        persist_org_id = stored.org_id
        persist_no_org = False
    else:
        membership_result = await session.execute(
            select(OrgMembership)
            .where(OrgMembership.user_id == user.id)
            .order_by(asc(OrgMembership.created_at))
        )
        membership = membership_result.scalars().first()
        if not membership:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No membership")

        org = await session.get(Org, membership.org_id)
        if not org:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Org not found")

        role = parse_membership_role(membership.role)
        new_access = _make_access_token(user, org, role)
        persist_org_id = org.id
        persist_no_org = False

    opaque, new_hash = create_refresh_token()

    new_refresh_obj = RefreshToken(
        user_id=user.id,
        token_hash=new_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        org_id=persist_org_id,
        no_org_scope=persist_no_org,
    )
    session.add(new_refresh_obj)
    await session.flush()

    return new_access, opaque


async def revoke_all_refresh_tokens(session: AsyncSession, user_id: UUID) -> None:
    """Revoke every refresh token belonging to ``user_id``."""
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked == False)  # noqa: E712
    )
    for row in result.scalars().all():
        row.revoked = True
        session.add(row)


async def logout_user(session: AsyncSession, refresh_token: str) -> None:
    """Revoke a refresh token."""
    token_hash = hash_refresh_token(refresh_token)
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    stored = result.scalars().first()
    if stored:
        stored.revoked = True
        session.add(stored)


async def get_me(session: AsyncSession, user_id: UUID) -> User:
    """Return the current user."""
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _make_access_token(user: User, org: Org, membership_role: Role) -> str:
    """Build access JWT including auxiliary claims for authenticated UIs."""
    eff = jwt_effective_role(user, membership_role)
    return create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "org_id": str(org.id),
        "tenant_slug": org.slug,
        "role": eff.value,
        "roles": jwt_roles_claim(eff),
        "user_type": jwt_user_type_claim(user.id),
    })


def make_super_admin_reset_access_token(user: User) -> str:
    """JWT without ``org_id`` for super admins clearing tenant scope."""
    eff = Role.SUPER_ADMIN
    return create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "role": eff.value,
        "roles": jwt_roles_claim(eff),
        "user_type": jwt_user_type_claim(user.id),
    })
