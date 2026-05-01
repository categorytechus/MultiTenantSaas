"""
Interactive chat script for testing the centralized LLM model loader.

This script allows you to chat with any of the three LLM providers (Bedrock,
OpenAI, Gemini) without requiring a .env file. Simply fill in your credentials
below and run:

    python test_models.py
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add the parent directory to the path so we can import models
sys.path.insert(0, str(Path(__file__).parent))

# ============================================================================
# CREDENTIALS - LOADED FROM models/.env
# ============================================================================

# Load env from models/.env
ENV_PATH = Path(__file__).parent / "models" / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

# AWS BEDROCK CONFIGURATION
BEDROCK_REGION = os.getenv("BEDROCK_REGION", "us-east-1")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
AWS_SESSION_TOKEN = os.getenv("AWS_SESSION_TOKEN", "")
BEDROCK_MODEL_NAME = os.getenv("BEDROCK_MODEL_NAME", "")
BEDROCK_MODEL_ARN = os.getenv("BEDROCK_MODEL_ARN", "")
BEDROCK_MODEL_PROVIDER = os.getenv("BEDROCK_MODEL_PROVIDER", "")

# OPENAI CONFIGURATION
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL_NAME = os.getenv("OPENAI_MODEL_NAME", "gpt-4-turbo")

# GOOGLE GEMINI CONFIGURATION
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-2.0-flash")

# Chat configuration
def _get_float_env(name: str, default: float) -> float:
    value = (os.getenv(name, "") or "").strip()
    return float(value) if value else default


def _get_int_env(name: str, default: int) -> int:
    value = (os.getenv(name, "") or "").strip()
    return int(value) if value else default


TEMPERATURE = _get_float_env("TEMPERATURE", 0.7)
MAX_TOKENS = _get_int_env("MAX_TOKENS", 500)

# ============================================================================
# SET ENVIRONMENT VARIABLES
# ============================================================================

# Set Bedrock environment variables
os.environ["BEDROCK_REGION"] = BEDROCK_REGION
if AWS_ACCESS_KEY_ID:
    os.environ["AWS_ACCESS_KEY_ID"] = AWS_ACCESS_KEY_ID
if AWS_SECRET_ACCESS_KEY:
    os.environ["AWS_SECRET_ACCESS_KEY"] = AWS_SECRET_ACCESS_KEY
if AWS_SESSION_TOKEN:
    os.environ["AWS_SESSION_TOKEN"] = AWS_SESSION_TOKEN

# Set OpenAI environment variable
if OPENAI_API_KEY:
    os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY

# Set Gemini environment variable
if GEMINI_API_KEY:
    os.environ["GEMINI_API_KEY"] = GEMINI_API_KEY


# ============================================================================
# PROVIDER SETUP
# ============================================================================

def get_available_providers():
    """Get list of available providers based on credentials."""
    providers = {}

    if BEDROCK_REGION:
        providers["1"] = {
            "name": "Bedrock",
            "config": {
                "api_key": True,
                "model_name": BEDROCK_MODEL_NAME,
                "model_arn": BEDROCK_MODEL_ARN,
                "model_provider": BEDROCK_MODEL_PROVIDER,
            }
        }

    if OPENAI_API_KEY:
        providers["2"] = {
            "name": "OpenAI",
            "config": {
                "api_key": True,
                "model_name": OPENAI_MODEL_NAME
            }
        }

    if GEMINI_API_KEY:
        providers["3"] = {
            "name": "Gemini",
            "config": {
                "api_key": True,
                "model_name": GEMINI_MODEL_NAME
            }
        }

    return providers


# ============================================================================
# CHAT FUNCTIONS
# ============================================================================

def chat_with_bedrock():
    """Interactive chat with Bedrock."""
    try:
        from models import bedrock

        print("\n" + "=" * 60)
        print("Bedrock Chat")
        print("=" * 60)
        active_bedrock_model = BEDROCK_MODEL_ARN or BEDROCK_MODEL_NAME
        print(f"Model: {active_bedrock_model}")
        if BEDROCK_MODEL_ARN:
            print(f"Provider: {BEDROCK_MODEL_PROVIDER}")
        print("Type 'quit' to exit\n")

        client = bedrock.load(
            model_name=BEDROCK_MODEL_NAME,
            model_arn=BEDROCK_MODEL_ARN or None,
            model_provider=BEDROCK_MODEL_PROVIDER or None,
            temperature=TEMPERATURE,
            config={"max_tokens": MAX_TOKENS}
        )

        while True:
            try:
                prompt = input("You: ").strip()
                if prompt.lower() in ["quit", "exit", "q"]:
                    break
                if not prompt:
                    continue

                print("\nAI: ", end="", flush=True)
                response = client.invoke(prompt)
                print(response)
                print()
            except KeyboardInterrupt:
                break

    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")


def chat_with_openai():
    """Interactive chat with OpenAI."""
    try:
        from models import openai

        print("\n" + "=" * 60)
        print("OpenAI Chat")
        print("=" * 60)
        print(f"Model: {OPENAI_MODEL_NAME}")
        print("Type 'quit' to exit\n")

        client = openai.load(
            model_name=OPENAI_MODEL_NAME,
            temperature=TEMPERATURE,
            config={"max_tokens": MAX_TOKENS}
        )

        while True:
            try:
                prompt = input("You: ").strip()
                if prompt.lower() in ["quit", "exit", "q"]:
                    break
                if not prompt:
                    continue

                print("\nAI: ", end="", flush=True)
                response = client.invoke(prompt)
                print(response)
                print()
            except KeyboardInterrupt:
                break

    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")


def chat_with_gemini():
    """Interactive chat with Gemini."""
    try:
        from models import gemini

        print("\n" + "=" * 60)
        print("Gemini Chat")
        print("=" * 60)
        print(f"Model: {GEMINI_MODEL_NAME}")
        print("Type 'quit' to exit\n")

        client = gemini.load(
            model_name=GEMINI_MODEL_NAME,
            temperature=TEMPERATURE,
            config={"max_output_tokens": MAX_TOKENS}
        )

        while True:
            try:
                prompt = input("You: ").strip()
                if prompt.lower() in ["quit", "exit", "q"]:
                    break
                if not prompt:
                    continue

                print("\nAI: ", end="", flush=True)
                response = client.invoke(prompt)
                print(response)
                print()
            except KeyboardInterrupt:
                break

    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")


def show_menu(providers):
    """Display provider selection menu."""
    print("\n" + "=" * 60)
    print("LLM Model Loader - Interactive Chat")
    print("=" * 60)
    print("\nAvailable Providers:\n")

    for key, provider in providers.items():
        print(f"  {key}. {provider['name']}")

    print(f"  0. Exit\n")

    choice = input("Select a provider (0-3): ").strip()
    return choice


def main():
    """Main chat interface."""
    providers = get_available_providers()

    if not providers:
        print("\n" + "=" * 60)
        print("❌ No providers configured!")
        print("=" * 60)
        print("\nPlease fill in at least one of the following credentials:")
        print("  - BEDROCK_REGION (for AWS Bedrock)")
        print("  - OPENAI_API_KEY (for OpenAI)")
        print("  - GEMINI_API_KEY (for Google Gemini)")
        print(f"\nFill credentials in: {ENV_PATH}\n")
        return

    while True:
        choice = show_menu(providers)

        if choice == "0":
            print("\nGoodbye! 👋\n")
            break
        elif choice == "1" and "1" in providers:
            chat_with_bedrock()
        elif choice == "2" and "2" in providers:
            chat_with_openai()
        elif choice == "3" and "3" in providers:
            chat_with_gemini()
        else:
            print("❌ Invalid choice. Please try again.")

if __name__ == "__main__":
    main()
