#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Socket.IO event handlers for streaming chat
"""

import logging
import asyncio
from flask_socketio import emit
from flask import request

from models.document import document_store, Message
from services.rag_service import rag_service
from config import config_manager

logger = logging.getLogger(__name__)


def register_socket_events(socketio):
    """Register Socket.IO event handlers"""
    
    @socketio.on('connect')
    def handle_connect():
        logger.info(f"Client connected: {request.sid}")
        emit('connected', {'status': 'connected'})
    
    @socketio.on('disconnect')
    def handle_disconnect():
        logger.info(f"Client disconnected: {request.sid}")
    
    @socketio.on('chat')
    def handle_chat(data):
        """Handle chat message with streaming response"""
        doc_id = data.get('doc_id')
        query = data.get('query')
        model_type = data.get('model_type', 'text')
        use_memory = data.get('use_memory', True)
        
        if not doc_id or not query:
            emit('error', {'message': 'Missing doc_id or query'})
            return
        
        doc = document_store.get_document(doc_id)
        if not doc:
            emit('error', {'message': 'Document not found'})
            return
        
        if doc.status != 'ready':
            emit('error', {'message': f'Document not ready: {doc.status}'})
            return
        
        logger.info(f"Chat request - doc: {doc_id}, query: {query[:50]}..., model: {model_type}")
        
        async def stream_response():
            try:
                async for chunk in rag_service.chat_stream(doc_id, query, model_type, use_memory):
                    # Handle special markers
                    chunk_clean = chunk.strip()
                    if chunk_clean.startswith('[SEARCHING]'):
                        emit('status', {'status': 'searching'})
                    elif chunk_clean.startswith('[PREPARING]'):
                        emit('status', {'status': 'preparing'})
                    elif chunk_clean.startswith('[PREPARED]'):
                        emit('status', {'status': 'prepared'})
                    elif chunk_clean.startswith('[THINKING_CHUNK]'):
                        # Stream thinking content
                        emit('thinking_chunk', {'content': chunk_clean.replace('[THINKING_CHUNK]', '')})
                    elif chunk_clean.startswith('[THINKING]'):
                        emit('thinking', {'content': chunk_clean.replace('[THINKING]', '').strip()})
                    elif chunk_clean.startswith('[NODES]'):
                        nodes_str = chunk_clean.replace('[NODES]', '').strip()
                        try:
                            import json
                            nodes = json.loads(nodes_str)
                            emit('nodes', {'nodes': nodes})
                        except:
                            pass
                    elif chunk_clean.startswith('[ANSWERING]'):
                        emit('status', {'status': 'answering'})
                    elif chunk_clean.startswith('[Error'):
                        emit('error', {'message': chunk_clean})
                    else:
                        emit('chunk', {'content': chunk})
                
                emit('done', {'status': 'completed'})
                
            except Exception as e:
                logger.error(f"Stream error: {e}")
                emit('error', {'message': str(e)})
        
        # Run async stream in event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(stream_response())
        finally:
            loop.close()
    
    @socketio.on('chat_sync')
    def handle_chat_sync(data):
        """Handle chat message without streaming (for vision model)"""
        doc_id = data.get('doc_id')
        query = data.get('query')
        model_type = data.get('model_type', 'vision')
        use_memory = data.get('use_memory', True)
        
        if not doc_id or not query:
            emit('error', {'message': 'Missing doc_id or query'})
            return
        
        doc = document_store.get_document(doc_id)
        if not doc or doc.status != 'ready':
            emit('error', {'message': 'Document not ready'})
            return
        
        async def get_response():
            try:
                full_response = ""
                async for chunk in rag_service.chat_stream(doc_id, query, model_type, use_memory):
                    chunk_clean = chunk.strip()
                    if chunk_clean.startswith('[SEARCHING]'):
                        emit('status', {'status': 'searching'})
                    elif chunk_clean.startswith('[THINKING_CHUNK]'):
                        # Stream thinking content
                        emit('thinking_chunk', {'content': chunk_clean.replace('[THINKING_CHUNK]', '')})
                    elif chunk_clean.startswith('[THINKING]'):
                        emit('thinking', {'content': chunk_clean.replace('[THINKING]', '').strip()})
                    elif chunk_clean.startswith('[NODES]'):
                        nodes_str = chunk_clean.replace('[NODES]', '').strip()
                        try:
                            import json
                            nodes = json.loads(nodes_str)
                            emit('nodes', {'nodes': nodes})
                        except:
                            pass
                    elif chunk_clean.startswith('[ANSWERING]'):
                        emit('status', {'status': 'answering'})
                    elif not chunk_clean.startswith('['):
                        full_response += chunk
                
                emit('response', {'content': full_response})
                emit('done', {'status': 'completed'})
                
            except Exception as e:
                logger.error(f"Response error: {e}")
                emit('error', {'message': str(e)})
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(get_response())
        finally:
            loop.close()
    
    @socketio.on('get_history')
    def handle_get_history(data):
        """Get chat history"""
        doc_id = data.get('doc_id')
        if not doc_id:
            emit('error', {'message': 'Missing doc_id'})
            return
        
        history = rag_service.get_chat_history(doc_id)
        emit('history', {'history': history})
    
    @socketio.on('clear_history')
    def handle_clear_history(data):
        """Clear chat history"""
        doc_id = data.get('doc_id')
        if not doc_id:
            emit('error', {'message': 'Missing doc_id'})
            return
        
        rag_service.clear_chat_history(doc_id)
        emit('history_cleared', {'doc_id': doc_id})
