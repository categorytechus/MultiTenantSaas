from langchain_text_splitters import RecursiveCharacterTextSplitter

def get_text_chunks(text: str, chunk_size: int = 500, chunk_overlap: int = 50):
    """
    Split text into manageable chunks for RAG.
    """
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        is_separator_regex=False,
    )
    return text_splitter.split_text(text)
