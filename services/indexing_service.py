#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Indexing service for PDF processing
"""

import os
import json
import asyncio
import logging
from typing import Optional

from models.document import Document, DocumentStore, document_store
from config import config_manager
from pageindex import page_index_main, set_api_config, ConfigLoader
from types import SimpleNamespace as pageindex_config

logger = logging.getLogger(__name__)


class IndexingService:
    """Service for indexing PDF documents"""
    
    def __init__(self, store: DocumentStore):
        self.store = store
    
    async def index_pdf(self, doc_id: str, pdf_path: str, filename: str) -> bool:
        """
        Index a PDF document using PageIndex
        
        Args:
            doc_id: Document ID
            pdf_path: Path to the PDF file
            filename: Original filename (used for result directory name)
        """
        try:
            # Update status
            self.store.update_document(doc_id, status='indexing')
            
            # Get model configuration (can be updated via web UI)
            model_config = config_manager.get_model_config('text')
            model_name = model_config.get('name', 'gpt-4o-mini')
            api_key = model_config.get('api_key', '')
            base_url = model_config.get('base_url', 'https://api.openai.com/v1')
            
            # Set API configuration for PageIndex
            if api_key:
                set_api_config(api_key, base_url)
            
            logger.info(f"Using model: {model_name}, base_url: {base_url}")
            
            # Create PageIndex options
            loader = ConfigLoader()
            opt = loader.load({
                'model': model_name,
                'toc_check_page_num': 20,
                'max_page_num_each_node': 10,
                'max_token_num_each_node': 20000,
                'if_add_node_id': 'yes',
                'if_add_node_summary': 'yes',
                'if_add_doc_description': 'no',
                'if_add_node_text': 'yes'
            })
            
            # Run indexing
            logger.info(f"Starting indexing for {pdf_path}")
            
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: page_index_main(pdf_path, opt)
            )
            
            # Get document to find result directory
            doc = self.store.get_document(doc_id)
            if not doc:
                raise ValueError(f"Document {doc_id} not found")
            
            # Save result to document's structure path
            os.makedirs(doc.result_dir, exist_ok=True)
            
            with open(doc.structure_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            
            # Update document status
            self.store.update_document(doc_id, status='indexed')
            
            logger.info(f"Indexing completed for {filename}, saved to {doc.structure_path}")
            return True
            
        except Exception as e:
            logger.error(f"Indexing error: {e}")
            self.store.update_document(doc_id, status='error', error_message=str(e))
            return False
    
    def get_indexing_status(self, doc_id: str) -> Optional[str]:
        """Get indexing status for a document"""
        doc = self.store.get_document(doc_id)
        if doc:
            return doc.status
        return None


# Create singleton instance
indexing_service = IndexingService(document_store)
