"""
Centralized LLM Model Loader

This module provides a single point of configuration for initializing LLM providers
(Bedrock, OpenAI, Gemini) from environment variables. All API keys and provider-level
configuration should be loaded from the .env file in the models/ directory.

Usage:
    from models import bedrock, openai, gemini

    # Load Bedrock client
    bedrock_client = bedrock.load(
        model_name="anthropic.claude-3-sonnet-20240229-v1:0",
        temperature=0.2,
        config={"max_tokens": 4096}
    )
    response = bedrock_client.invoke("Your prompt here")

    # Load OpenAI client
    openai_client = openai.load(
        model_name="gpt-4-turbo",
        temperature=0.7,
        config={"max_tokens": 2048}
    )
    response = openai_client.invoke("Your prompt here")

    # Load Gemini client
    gemini_client = gemini.load(
        model_name="gemini-pro",
        temperature=0.5,
        config={"max_output_tokens": 4096}
    )
    response = gemini_client.invoke("Your prompt here")
"""

import os
from pathlib import Path
from typing import Optional, Dict, Any

from dotenv import load_dotenv

# Load environment variables from .env file in models/ directory
# The .env file should be in the same directory as this module
models_dir = Path(__file__).parent
env_file_path = models_dir / ".env"
load_dotenv(dotenv_path=env_file_path)


class BedrockModel:
    """
    AWS Bedrock LLM Model Loader

    Loads and initializes AWS Bedrock clients using credentials and region
    from environment variables.

    Required environment variables:
        - BEDROCK_REGION: AWS region where Bedrock is available (e.g., 'us-east-1')
        - AWS_ACCESS_KEY_ID: AWS access key (optional, can use IAM role)
        - AWS_SECRET_ACCESS_KEY: AWS secret key (optional, can use IAM role)
    """

    def load(
        self,
        model_name: Optional[str] = None,
        model_arn: Optional[str] = None,
        model_provider: Optional[str] = None,
        temperature: float = 0.0,
        config: Optional[Dict[str, Any]] = None
        
    ):
        """
        Initialize and return a Bedrock chat client.

        Args:
            model_name: Bedrock model ID (e.g., 'anthropic.claude-3-sonnet-20240229-v1:0')
            model_arn: Optional Bedrock custom/provisioned model ARN
            model_provider: Optional provider name when using model ARN
            temperature: Sampling temperature for response generation (0.0 to 1.0)
            config: Additional configuration dict passed to the client
                    Common keys: max_tokens, top_p, top_k, etc.

        Returns:
            A ChatBedrock client instance with invoke() method

        Raises:
            ValueError: If required environment variables are missing
        """
        try:
            from langchain_aws import ChatBedrock
        except ImportError:
            raise ImportError(
                "langchain-aws is not installed. Install it with: pip install langchain-aws"
            )

        # Get Bedrock region from environment
        region = os.getenv("BEDROCK_REGION")
        if not region:
            raise ValueError(
                "Missing required environment variable: BEDROCK_REGION\n"
                f"Please set BEDROCK_REGION in {env_file_path}\n"
                "Example: BEDROCK_REGION=us-east-1"
            )

        # Build model_kwargs with temperature and any additional config
        model_kwargs = {"temperature": temperature}
        if config:
            model_kwargs.update(config)

        if not model_name and not model_arn:
            raise ValueError(
                "Bedrock requires either model_name or model_arn.\n"
                "Example model_name: anthropic.claude-3-sonnet-20240229-v1:0\n"
                "Example model_arn: arn:aws:bedrock:...:model/your-model"
            )

        if model_arn and not model_provider:
            raise ValueError(
                "model_provider is required when using model_arn for Bedrock."
            )

        # Create and return Bedrock client
        # AWS credentials will be auto-detected from:
        # 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
        # 2. AWS credentials file (~/.aws/credentials)
        # 3. IAM role (if running in AWS)
        client_kwargs = {
            "region_name": region,
            "model_kwargs": model_kwargs,
        }
        if model_arn:
            client_kwargs["model_id"] = model_arn
            client_kwargs["provider"] = model_provider
        else:
            client_kwargs["model_id"] = model_name

        client = ChatBedrock(**client_kwargs)

        return client


class OpenAIModel:
    """
    OpenAI LLM Model Loader

    Loads and initializes OpenAI chat clients using API key
    from environment variables.

    Required environment variables:
        - OPENAI_API_KEY: Your OpenAI API key (get from https://platform.openai.com/api-keys)
    """

    def load(
        self,
        model_name: str,
        temperature: float = 0.0,
        config: Optional[Dict[str, Any]] = None
    ):
        """
        Initialize and return an OpenAI chat client.

        Args:
            model_name: The model name (e.g., 'gpt-4-turbo', 'gpt-3.5-turbo')
            temperature: Sampling temperature for response generation (0.0 to 2.0)
            config: Additional configuration dict passed to the client
                    Common keys: max_tokens, top_p, presence_penalty, etc.

        Returns:
            A ChatOpenAI client instance with invoke() method

        Raises:
            ValueError: If required environment variables are missing
        """
        try:
            from langchain_openai import ChatOpenAI
        except ImportError:
            raise ImportError(
                "langchain-openai is not installed. Install it with: pip install langchain-openai"
            )

        # Get OpenAI API key from environment
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "Missing required environment variable: OPENAI_API_KEY\n"
                f"Please set OPENAI_API_KEY in {env_file_path}\n"
                "Get your API key from: https://platform.openai.com/api-keys"
            )

        # Build client kwargs with temperature and any additional config
        client_kwargs = {
            "model": model_name,
            "temperature": temperature,
            "api_key": api_key,
        }
        if config:
            client_kwargs.update(config)

        # Create and return OpenAI client
        client = ChatOpenAI(**client_kwargs)

        return client


class GeminiModel:
    """
    Google Gemini LLM Model Loader

    Loads and initializes Google Gemini chat clients using API key
    from environment variables.

    Required environment variables:
        - GEMINI_API_KEY: Your Google Gemini API key (get from https://makersuite.google.com/app/apikey)

    Note: This loader uses langchain-google-genai with the Gemini API.
    For Vertex AI integration, see documentation for alternative setup.
    """

    def load(
        self,
        model_name: str,
        temperature: float = 0.0,
        config: Optional[Dict[str, Any]] = None
    ):
        """
        Initialize and return a Google Gemini chat client.

        Args:
            model_name: The model name (e.g., 'gemini-pro', 'gemini-1.5-pro')
            temperature: Sampling temperature for response generation (0.0 to 2.0)
            config: Additional configuration dict passed to the client
                    Common keys: max_output_tokens, top_p, top_k, etc.

        Returns:
            A ChatGoogleGenerativeAI client instance with invoke() method

        Raises:
            ValueError: If required environment variables are missing
        """
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
        except ImportError:
            raise ImportError(
                "langchain-google-genai is not installed. Install it with: pip install langchain-google-genai"
            )

        # Get Gemini API key from environment
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError(
                "Missing required environment variable: GEMINI_API_KEY\n"
                f"Please set GEMINI_API_KEY in {env_file_path}\n"
                "Get your API key from: https://makersuite.google.com/app/apikey"
            )

        # Build client kwargs with temperature and any additional config.
        # NOTE: Gemini client retries can make quota failures appear as long hangs.
        # We default to fail-fast and let callers opt into retries via config.
        client_kwargs = {
            "model": model_name,
            "temperature": temperature,
            "google_api_key": api_key,
            "max_retries": 0,
        }
        if config:
            client_kwargs.update(config)

        # Create and return Gemini client
        client = ChatGoogleGenerativeAI(**client_kwargs)

        return client


# Create module-level instances that agents can import and use
bedrock = BedrockModel()
openai = OpenAIModel()
gemini = GeminiModel()


def load_llm(
    provider: Optional[str] = None,
    model_name: Optional[str] = None,
    temperature: Optional[float] = None,
    config: Optional[Dict[str, Any]] = None,
):
    """
    Load an LLM by provider using centralized config from models/.env.

    Agents should pass only provider/model intent; keys and provider-level
    configuration (region, ARNs, credentials) are resolved here.
    """
    resolved_provider = (provider or os.getenv("LLM_PROVIDER", "")).strip().lower()
    resolved_temperature = (
        temperature if temperature is not None else float(os.getenv("LLM_TEMPERATURE", "0"))
    )
    runtime_config = config or {}

    if resolved_provider == "openai":
        return openai.load(
            model_name=(model_name or os.getenv("OPENAI_MODEL_NAME", "")).strip(),
            temperature=resolved_temperature,
            config=runtime_config,
        )
    if resolved_provider == "gemini":
        return gemini.load(
            model_name=(model_name or os.getenv("GEMINI_MODEL_NAME", "")).strip(),
            temperature=resolved_temperature,
            config=runtime_config,
        )

    # Default path is bedrock.
    return bedrock.load(
        model_name=(model_name or os.getenv("BEDROCK_MODEL_NAME", "")).strip() or None,
        model_arn=os.getenv("BEDROCK_MODEL_ARN", "").strip() or None,
        model_provider=os.getenv("BEDROCK_MODEL_PROVIDER", "").strip() or None,
        temperature=resolved_temperature,
        config=runtime_config,
    )
