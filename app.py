#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
PageIndex Chat UI - Flask Application
A chat interface for PDF document QA with PageIndex RAG support
"""

import os
import logging
import json
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO

from config import config_manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__, 
            static_folder='static',
            template_folder='templates')

app.config['SECRET_KEY'] = config_manager.get_secret_key()
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size

# Enable CORS
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Import and register routes
from routes.api import api_bp
app.register_blueprint(api_bp, url_prefix='/api')

# Register Socket.IO event handlers
from routes.socket_handlers import register_socket_events
register_socket_events(socketio)

# Serve frontend
@app.route('/')
def index():
    return send_from_directory(app.template_folder, 'index.html')

# Serve static files through /api/static to work through proxies
@app.route('/api/static/<path:filename>')
def serve_static(filename):
    return send_from_directory(app.static_folder, filename)

# Serve results files (images, etc.)
@app.route('/api/results/<path:filename>')
def serve_results(filename):
    """Serve files from results directory (page images, etc.)"""
    from models.document import RESULTS_DIR
    return send_from_directory(RESULTS_DIR, filename)

# Error handlers
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def server_error(e):
    logger.error(f"Server error: {e}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Ensure directories exist (handled by DocumentStore, but be safe)
    from models.document import UPLOADS_DIR, RESULTS_DIR
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    
    logger.info("Starting PageIndex Chat UI server...")
    socketio.run(app, host='0.0.0.0', port=5001, debug=True, allow_unsafe_werkzeug=True)
