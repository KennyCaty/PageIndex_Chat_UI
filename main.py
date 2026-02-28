#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
PageIndex Chat UI - Application Entry Point

A chat interface for PDF document QA with PageIndex RAG support.
Features:
- PDF upload and indexing
- Text-based RAG with streaming responses
- Vision-based RAG with PDF page images
- Conversation memory
- Customizable model configuration (API key, base URL)
"""

from app import app, socketio
from config import config_manager

if __name__ == '__main__':
    # Get configuration from config manager
    host = config_manager.get_host()
    port = config_manager.get_port()
    debug = config_manager.get_debug()
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                    PageIndex Chat UI                         ║
╠══════════════════════════════════════════════════════════════╣
║  Server running at: http://{host}:{port}                      ║
║  Press Ctrl+C to stop                                        ║
╚══════════════════════════════════════════════════════════════╝
    """)
    
    socketio.run(app, host=host, port=port, debug=debug)
