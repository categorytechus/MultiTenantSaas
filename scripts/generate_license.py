import argparse
import datetime
import json
import os
import sys
from jose import jwt

def generate_license(org_id: str, start_date_str: str, expiry_date_str: str, features_str: str, private_key_path: str):
    """Generate a signed JWT license key."""
    
    if not os.path.exists(private_key_path):
        print(f"Error: Private key file not found at {private_key_path}", file=sys.stderr)
        sys.exit(1)
        
    with open(private_key_path, "r") as f:
        private_key = f.read()
        
    try:
        start_date = datetime.datetime.fromisoformat(start_date_str)
        expiry_date = datetime.datetime.fromisoformat(expiry_date_str)
    except ValueError as e:
        print(f"Error parsing dates: {e}. Use ISO format e.g., 2026-01-01T00:00:00", file=sys.stderr)
        sys.exit(1)
        
    try:
        features = [f.strip() for f in features_str.split(",") if f.strip()]
    except Exception as e:
        print(f"Error parsing features: {e}", file=sys.stderr)
        sys.exit(1)
        
    payload = {
        "sub": org_id,
        "nbf": int(start_date.timestamp()),
        "exp": int(expiry_date.timestamp()),
        "features": features,
        "type": "private_deployment_license"
    }
    
    token = jwt.encode(payload, private_key, algorithm="RS256")
    
    print("\n--- LICENSE KEY GENERATED SUCCESSFULLY ---")
    print(f"Org ID:   {org_id}")
    print(f"Valid:    {start_date} to {expiry_date}")
    print(f"Features: {features}")
    print("\nProvide this string to the client as the CLIENT_JWT_LICENSE_TOKEN environment variable:")
    print("--------------------------------------------------------------------------------")
    print(token)
    print("--------------------------------------------------------------------------------\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Private Deployment License Key")
    parser.add_argument("--org", required=True, help="Organization Identifier (e.g. uuid or name)")
    parser.add_argument("--start", required=True, help="Start Date (ISO format, e.g. 2026-01-01T00:00:00)")
    parser.add_argument("--expires", required=True, help="Expiry Date (ISO format, e.g. 2026-12-31T23:59:59)")
    parser.add_argument("--features", 
        type=str, 
        default="documents,ai_assistant,web_urls", 
        help="Comma-separated list of enabled features/modules. Valid modules: documents, ai_assistant, web_urls, ai_images, ai_links, report_generation, cost_seg, api_calling."
    )
    parser.add_argument("--key", default="private_key.pem", help="Path to private_key.pem")
    
    args = parser.parse_args()
    
    generate_license(args.org, args.start, args.expires, args.features, args.key)
