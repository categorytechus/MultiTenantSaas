import logging

logger = logging.getLogger(__name__)

class LettaClient:
    """
    Mock client for Letta (Long-term memory / MemGPT).
    In a real implementation, this would call the Letta REST API to fetch relevant memories
    or conversation history for a given user_id.
    """
    def __init__(self, endpoint: str = None):
        self.endpoint = endpoint or "http://letta-service:8080"

    async def get_recent_context(self, user_id: str, limit: int = 5):
        """
        Fetches the last N turns of conversation for the user.
        """
        logger.info(f"Fetching Letta context for user {user_id}...")
        
        # Placeholder for actual API call
        # return await self.client.get(f"/context/{user_id}")
        
        return [
            {"role": "user", "content": "I was asking about company policies earlier."},
            {"role": "assistant", "content": "Yes, I remember. We covered the refund policy."}
        ]
