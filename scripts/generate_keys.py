import argparse
import os
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

def generate_keys(output_dir: str):
    """Generate RSA private and public keys for licensing."""
    print(f"Generating 2048-bit RSA key pair in {output_dir}...")
    
    # Generate private key
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    
    # Generate public key
    public_key = private_key.public_key()
    
    # Serialize private key to PEM
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    
    # Serialize public key to PEM
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    
    os.makedirs(output_dir, exist_ok=True)
    
    private_path = os.path.join(output_dir, "private_key.pem")
    public_path = os.path.join(output_dir, "public_key.pem")
    
    with open(private_path, "wb") as f:
        f.write(private_pem)
        
    with open(public_path, "wb") as f:
        f.write(public_pem)
        
    print(f"Success! Keys saved to:\n- {private_path}\n- {public_path}")
    print("\nIMPORTANT: Add private_key.pem to your .gitignore!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Master RSA Keys for Licensing")
    parser.add_argument("--dir", type=str, default=".", help="Directory to save the keys")
    args = parser.parse_args()
    
    generate_keys(args.dir)
