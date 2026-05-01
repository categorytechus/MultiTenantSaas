"""
Models package - Centralized LLM provider loader

This package provides a single point of initialization for all LLM providers.
Import the provider you need and call load() with your model configuration.

Example:
    from models import bedrock, openai, gemini

    # Use Bedrock
    client = bedrock.load(model_name="anthropic.claude-3-sonnet-20240229-v1:0")

    # Use OpenAI
    client = openai.load(model_name="gpt-4-turbo")

    # Use Gemini
    client = gemini.load(model_name="gemini-pro")
"""

from .load_models import bedrock, openai, gemini, load_llm

__all__ = ["bedrock", "openai", "gemini", "load_llm"]
