"""
PageIndex - PDF indexing and tree structure generation
"""

from .page_index import page_index_main, page_index
from .utils import (
    set_api_config,
    get_api_key,
    get_base_url,
    ConfigLoader,
    create_node_mapping,
    extract_pdf_page_images,
    get_page_images_for_nodes,
)
from types import SimpleNamespace as config

__all__ = [
    'page_index_main',
    'page_index',
    'set_api_config',
    'get_api_key',
    'get_base_url',
    'ConfigLoader',
    'config',
    'create_node_mapping',
    'extract_pdf_page_images',
    'get_page_images_for_nodes',
]
