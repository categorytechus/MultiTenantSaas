import os
from jose import jwt, JWTError
from app.core.config import settings

class InvalidLicenseError(Exception):
    pass

class ExpiredLicenseError(Exception):
    pass

def verify_license() -> dict:
    """
    Reads the CLIENT_JWT_LICENSE_TOKEN from the environment and verifies its cryptographic
    signature using LICENSE_PUBLIC_KEY.
    
    Raises:
        InvalidLicenseError: If the token is missing, tampered with, or invalid.
        ExpiredLicenseError: If the token is mathematically valid but has expired.
        
    Returns:
        dict: The decoded token payload containing 'sub' (org_id), 'exp', and 'features'.
    """
    # Fetch from pydantic settings (which automatically handles local .env files and Docker env vars)
    license_key = settings.CLIENT_JWT_LICENSE_TOKEN
    public_key = settings.LICENSE_PUBLIC_KEY
    
    if not license_key:
        raise InvalidLicenseError("No CLIENT_JWT_LICENSE_TOKEN found in environment.")
        
    if not public_key:
        raise InvalidLicenseError("No LICENSE_PUBLIC_KEY found in environment to verify the license.")
        
    try:
        # jwt.decode verifies both the RS256 signature and the exp/nbf claims automatically.
        payload = jwt.decode(
            license_key, 
            public_key, 
            algorithms=["RS256"]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise ExpiredLicenseError("The private deployment license has expired.")
    except JWTError as e:
        raise InvalidLicenseError(f"Invalid license signature or claims: {e}")
