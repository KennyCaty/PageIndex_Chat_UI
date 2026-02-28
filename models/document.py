#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Document models for PageIndex Chat UI
"""

import os
import json
import uuid
import time
import shutil
from typing import Dict, List, Optional
from dataclasses import dataclass, field, asdict
from datetime import datetime

# Base directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(BASE_DIR, 'uploads')
RESULTS_DIR = os.path.join(BASE_DIR, 'results')


@dataclass
class Message:
    """Chat message"""
    role: str  # 'user' or 'assistant'
    content: str
    timestamp: float = field(default_factory=time.time)
    nodes: List[str] = field(default_factory=list)
    thinking: str = ''
    
    def to_dict(self):
        return asdict(self)


@dataclass
class Document:
    """Document representation"""
    doc_id: str
    filename: str  # original filename without doc_id prefix
    file_path: str  # path to PDF in uploads/
    result_dir_name: str = ''  # directory name in results/ (defaults to {doc_id}_{filename})
    status: str = 'pending'  # pending, indexing, ready, error
    created_at: float = field(default_factory=time.time)
    page_count: int = 0
    error_message: str = ''
    
    def __post_init__(self):
        """Set default result_dir_name if not provided"""
        if not self.result_dir_name:
            self.result_dir_name = f"{self.doc_id}_{self.filename}"
    
    @property
    def result_dir(self) -> str:
        """Get result directory for this document"""
        return os.path.join(RESULTS_DIR, self.result_dir_name)
    
    @property
    def metadata_path(self) -> str:
        """Get metadata file path"""
        return os.path.join(self.result_dir, 'metadata.json')
    
    @property
    def structure_path(self) -> str:
        """Get structure file path"""
        return os.path.join(self.result_dir, 'structure.json')
    
    @property
    def images_dir(self) -> str:
        """Get images directory"""
        return os.path.join(self.result_dir, 'images')
    
    @property
    def chat_history_path(self) -> str:
        """Get chat history file path"""
        return os.path.join(self.result_dir, 'chat_history.json')
    
    def to_dict(self):
        return asdict(self)


class DocumentStore:
    """Document store with persistence"""
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.documents: Dict[str, Document] = {}
        self.chat_history: Dict[str, List[Message]] = {}
        self.tree_cache: Dict[str, dict] = {}
        self.node_map_cache: Dict[str, dict] = {}
        self.page_images_cache: Dict[str, dict] = {}
        
        # Ensure base directories exist
        os.makedirs(UPLOADS_DIR, exist_ok=True)
        os.makedirs(RESULTS_DIR, exist_ok=True)
        
        # Load persisted documents on init
        self._load_from_disk()
    
    def _load_from_disk(self):
        """Load document metadata by scanning results directories"""
        if not os.path.exists(RESULTS_DIR):
            return
        
        print("Scanning results directory to recover documents...")
        
        for dir_name in os.listdir(RESULTS_DIR):
            doc_dir = os.path.join(RESULTS_DIR, dir_name)
            if not os.path.isdir(doc_dir):
                continue
            
            metadata_path = os.path.join(doc_dir, 'metadata.json')
            if not os.path.exists(metadata_path):
                continue
            
            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                doc_id = data['doc_id']
                filename = data['filename']
                result_dir_name = data.get('result_dir_name', dir_name)
                
                # Find PDF file
                pdf_path = os.path.join(UPLOADS_DIR, f"{doc_id}_{filename}")
                if not os.path.exists(pdf_path):
                    print(f"Skipping document with missing PDF: {dir_name}")
                    continue
                
                doc = Document(
                    doc_id=doc_id,
                    filename=filename,
                    file_path=pdf_path,
                    result_dir_name=result_dir_name,
                    status=data.get('status', 'ready'),
                    created_at=data.get('created_at', os.path.getctime(doc_dir)),
                    page_count=data.get('page_count', 0),
                    error_message=data.get('error_message', '')
                )
                self.documents[doc.doc_id] = doc
                self.chat_history[doc.doc_id] = []
                print(f"Recovered document: {filename} (id: {doc_id}, status: {doc.status})")
                    
            except Exception as e:
                print(f"Error loading metadata for {dir_name}: {e}")
        
        print(f"Total documents recovered: {len(self.documents)}")
    
    def _save_document_metadata(self, doc: Document):
        """Save document metadata to its result directory"""
        os.makedirs(doc.result_dir, exist_ok=True)
        
        metadata = {
            'doc_id': doc.doc_id,
            'filename': doc.filename,
            'result_dir_name': doc.result_dir_name,
            'status': doc.status,
            'created_at': doc.created_at,
            'page_count': doc.page_count,
            'error_message': doc.error_message
        }
        
        try:
            with open(doc.metadata_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving document metadata: {e}")
    
    def add_document(self, doc: Document):
        """Add a document to the store"""
        self.documents[doc.doc_id] = doc
        self.chat_history[doc.doc_id] = []
        os.makedirs(doc.result_dir, exist_ok=True)
        self._save_document_metadata(doc)
    
    def get_document(self, doc_id: str) -> Optional[Document]:
        """Get a document by ID"""
        return self.documents.get(doc_id)
    
    def get_document_by_name(self, filename: str) -> Optional[Document]:
        """Get a document by filename"""
        for doc in self.documents.values():
            if doc.filename == filename:
                return doc
        return None
    
    def update_document(self, doc_id: str, **kwargs):
        """Update document properties"""
        if doc_id in self.documents:
            doc = self.documents[doc_id]
            for key, value in kwargs.items():
                if hasattr(doc, key):
                    setattr(doc, key, value)
            self._save_document_metadata(doc)
    
    def get_all_documents(self) -> List[Document]:
        """Get all documents"""
        return list(self.documents.values())
    
    def delete_document(self, doc_id: str):
        """Delete a document and all its data"""
        if doc_id in self.documents:
            doc = self.documents[doc_id]
            
            # Delete PDF file
            if doc.file_path and os.path.exists(doc.file_path):
                os.remove(doc.file_path)
            
            # Delete entire result directory
            if os.path.exists(doc.result_dir):
                shutil.rmtree(doc.result_dir)
            
            # Remove from store
            del self.documents[doc_id]
            self.chat_history.pop(doc_id, None)
            self.tree_cache.pop(doc_id, None)
            self.node_map_cache.pop(doc_id, None)
            self.page_images_cache.pop(doc_id, None)
    
    def add_message(self, doc_id: str, message: Message):
        """Add a message to chat history"""
        if doc_id in self.chat_history:
            self.chat_history[doc_id].append(message)
            # Persist chat history to disk
            self._save_chat_history(doc_id)
    
    def _save_chat_history(self, doc_id: str):
        """Save chat history to disk"""
        doc = self.get_document(doc_id)
        if not doc:
            return
        
        history = self.chat_history.get(doc_id, [])
        history_data = [msg.to_dict() for msg in history]
        
        try:
            with open(doc.chat_history_path, 'w', encoding='utf-8') as f:
                json.dump(history_data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving chat history: {e}")
    
    def _load_chat_history(self, doc_id: str):
        """Load chat history from disk"""
        doc = self.get_document(doc_id)
        if not doc or not os.path.exists(doc.chat_history_path):
            return []
        
        try:
            with open(doc.chat_history_path, 'r', encoding='utf-8') as f:
                history_data = json.load(f)
            
            messages = []
            for msg_data in history_data:
                messages.append(Message(
                    role=msg_data.get('role', 'user'),
                    content=msg_data.get('content', ''),
                    timestamp=msg_data.get('timestamp', 0),
                    nodes=msg_data.get('nodes', []),
                    thinking=msg_data.get('thinking', '')
                ))
            return messages
        except Exception as e:
            print(f"Error loading chat history: {e}")
            return []
    
    def get_chat_history(self, doc_id: str) -> List[Message]:
        """Get chat history for a document"""
        # Try memory cache first
        if doc_id in self.chat_history and self.chat_history[doc_id]:
            return self.chat_history[doc_id]
        
        # Try loading from disk
        history = self._load_chat_history(doc_id)
        if history:
            self.chat_history[doc_id] = history
        return self.chat_history.get(doc_id, [])
    
    def clear_chat_history(self, doc_id: str):
        """Clear chat history for a document"""
        self.chat_history[doc_id] = []
        
        # Also delete the file from disk
        doc = self.get_document(doc_id)
        if doc and os.path.exists(doc.chat_history_path):
            try:
                os.remove(doc.chat_history_path)
            except Exception as e:
                print(f"Error deleting chat history file: {e}")
    
    def cache_tree(self, doc_id: str, tree: dict):
        """Cache parsed tree structure"""
        self.tree_cache[doc_id] = tree
    
    def get_tree(self, doc_id: str) -> Optional[dict]:
        """Get cached tree structure"""
        # Try memory cache first
        if doc_id in self.tree_cache:
            return self.tree_cache[doc_id]
        
        # Try loading from disk
        doc = self.get_document(doc_id)
        if doc and os.path.exists(doc.structure_path):
            try:
                with open(doc.structure_path, 'r', encoding='utf-8') as f:
                    tree_data = json.load(f)
                # Extract 'structure' field if present (format: {"doc_name": ..., "structure": [...]})
                tree = tree_data.get('structure', tree_data)
                self.tree_cache[doc_id] = tree
                return tree
            except Exception as e:
                print(f"Error loading tree from disk: {e}")
        return None
    
    def cache_node_map(self, doc_id: str, node_map: dict):
        """Cache node mapping"""
        self.node_map_cache[doc_id] = node_map
    
    def get_node_map(self, doc_id: str) -> Optional[dict]:
        """Get cached node mapping"""
        return self.node_map_cache.get(doc_id)
    
    def cache_page_images(self, doc_id: str, page_images: dict):
        """Cache page images mapping"""
        self.page_images_cache[doc_id] = page_images
    
    def get_page_images(self, doc_id: str) -> Optional[dict]:
        """Get cached page images"""
        # Try memory cache first
        if doc_id in self.page_images_cache:
            return self.page_images_cache[doc_id]
        
        # Try loading from disk by scanning the images directory
        doc = self.get_document(doc_id)
        if doc and os.path.exists(doc.images_dir):
            try:
                page_images = {}
                for filename in os.listdir(doc.images_dir):
                    if filename.endswith(('.png', '.jpg', '.jpeg')):
                        # filename format: page_X.png or page_X.jpg
                        try:
                            page_num = int(filename.replace('page_', '').split('.')[0])
                            page_images[page_num] = os.path.join(doc.images_dir, filename)
                        except ValueError:
                            continue
                if page_images:
                    self.page_images_cache[doc_id] = page_images
                    return page_images
            except Exception as e:
                print(f"Error loading page images from disk: {e}")
        return None


# Global store instance
document_store = DocumentStore()
