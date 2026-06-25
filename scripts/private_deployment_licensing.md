# Private Deployment Licensing Scripts

This folder contains the admin tools required to generate mathematical licenses (RSA-signed JWTs) for private deployments of the Kolmio SaaS platform.

**⚠️ CRITICAL SECURITY WARNING ⚠️**
* **NEVER** deploy the `private_key.pem` file to a client server. It must never leave your secure local machine.
* **NEVER** commit `private_key.pem` to Git or a public repository. If this key is leaked, anyone can forge infinite licenses.
* **DO NOT** delete these python scripts. They are harmless on their own and are ignored by the backend Docker image, but they are required to generate future licenses.

## Prerequisites

These scripts require the `python-jose` and `cryptography` libraries. 

If you are generating these keys within your main development environment, simply ensure you have run `make install` from the project root first (which creates the `src/server/.venv`). 

If you are running these scripts on a separate, secure offline machine (highly recommended for the master keypair), you can set up a standalone environment:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install python-jose cryptography
```
*(If you do this, run the scripts below using simply `python3` while the venv is active, instead of the `src/server/.venv` paths).*

## Workflow

### 1. Generate Master Keypair (One-Time Setup)
Run this command from the root of the project to generate your master `private_key.pem` and `public_key.pem`:
**Windows:**
```bash
src\server\.venv\Scripts\python.exe scripts/generate_keys.py
```

**Mac/Linux:**
```bash
src/server/.venv/bin/python scripts/generate_keys.py
```
*(Ensure `private_key.pem` is immediately added to your `.gitignore` or stored in a secure vault).*

### 2. Generate a Client License Token
Whenever you deploy a private instance to a client, generate a token using your private key:
**Windows:**
```bash
src\server\.venv\Scripts\python.exe scripts/generate_license.py --org "client-org-slug" --start "2024-01-01T00:00:00" --expires "2025-01-01T00:00:00" --features "core"
```

**Mac/Linux:**
```bash
src/server/.venv/bin/python scripts/generate_license.py --org "client-org-slug" --start "2024-01-01T00:00:00" --expires "2025-01-01T00:00:00" --features "core"
```
This will output a `CLIENT_JWT_LICENSE_TOKEN`.

### 3. Deploying to the Client
On the client's deployment server, set the following two variables in their `.env` file:
```env
# Paste the exact multi-line text from public_key.pem inside double quotes!
LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
(your public key text here)
-----END PUBLIC KEY-----"

# Paste the generated JWT token
CLIENT_JWT_LICENSE_TOKEN="<your_generated_token>"
```

### Public vs Private Deployments
* **Public SaaS:** Leave `CLIENT_JWT_LICENSE_TOKEN` out of the `.env` file. The server will bypass license checks and act as a multi-tenant public SaaS (e.g. using Stripe for billing).
* **Private Deployment:** Setting `CLIENT_JWT_LICENSE_TOKEN` instantly locks the server down to cryptographic verification.
