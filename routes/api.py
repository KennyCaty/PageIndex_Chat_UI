#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
API routes for PageIndex Chat UI
"""

import os
import uuid
import json
import logging
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename

from models.document import Document, document_store, UPLOADS_DIR, RESULTS_DIR
from models.session import session_store
from services.rag_service import rag_service
from services.indexing_service import indexing_service
from services.skill_manager import skill_manager, Skill
from config import config_manager

logger = logging.getLogger(__name__)

api_bp = Blueprint('api', __name__)


# ============= Configuration Routes =============

@api_bp.route('/config/models', methods=['GET'])
def get_models():
    return jsonify({
        'models': config_manager.get_all_models(),
        'default_type': config_manager.get_default_model_type()
    })


@api_bp.route('/config/models/<model_type>', methods=['GET', 'PUT'])
def model_config(model_type):
    if request.method == 'GET':
        return jsonify(config_manager.get_model_config(model_type))
    data = request.json
    config_manager.set_model_config(model_type, data)
    return jsonify({'success': True, 'message': f'{model_type} model config updated'})


@api_bp.route('/config/default-model', methods=['PUT'])
def set_default_model():
    data = request.json
    model_type = data.get('model_type')
    if model_type not in ['text', 'vision']:
        return jsonify({'error': 'Invalid model type'}), 400
    config_manager.set_default_model_type(model_type)
    return jsonify({'success': True, 'default_type': model_type})


# ============= Document Routes =============

@api_bp.route('/documents', methods=['GET'])
def list_documents():
    docs = [doc.to_dict() for doc in document_store.get_all_documents()]
    # Sort: ready first, then by created_at desc
    docs.sort(key=lambda d: (0 if d['status'] == 'ready' else 1, -d.get('created_at', 0)))
    return jsonify({'documents': docs})


@api_bp.route('/documents/upload', methods=['POST'])
def upload_document():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    if not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Only PDF files are supported'}), 400
    
    try:
        now = datetime.now()
        datetime_prefix = now.strftime("%Y%m%d_%H%M%S")
        doc_id = f"{datetime_prefix}_{str(uuid.uuid4())[:4]}"
        
        filename = secure_filename(file.filename)
        os.makedirs(UPLOADS_DIR, exist_ok=True)
        file_path = os.path.join(UPLOADS_DIR, f"{doc_id}_{filename}")
        file.save(file_path)
        
        doc = Document(doc_id=doc_id, filename=filename, file_path=file_path, status='pending')
        document_store.add_document(doc)
        document_store.set_stage(doc_id, 'queued', '已入队，等待索引...')
        
        from threading import Thread
        def run_indexing():
            import asyncio
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                success = loop.run_until_complete(
                    indexing_service.index_pdf(doc_id, file_path, filename)
                )
                if success:
                    doc = document_store.get_document(doc_id)
                    if doc and os.path.exists(doc.structure_path):
                        loop.run_until_complete(
                            rag_service.prepare_document(doc_id, file_path, doc.structure_path)
                        )
                        try:
                            loop.run_until_complete(rag_service.auto_analyze_document(doc_id))
                        except Exception as e:
                            logger.warning(f"Auto-analysis failed (non-fatal): {e}")
            finally:
                loop.close()
        
        Thread(target=run_indexing).start()
        
        return jsonify({
            'success': True,
            'document': doc.to_dict(),
            'message': 'Document uploaded, indexing started'
        })
    except Exception as e:
        logger.error(f"Upload error: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/documents/<doc_id>', methods=['GET'])
def get_document(doc_id):
    doc = document_store.get_document(doc_id)
    if not doc:
        return jsonify({'error': 'Document not found'}), 404
    return jsonify({'document': doc.to_dict()})


@api_bp.route('/documents/<doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    """Delete a document's index. Sessions that referenced it keep their history."""
    try:
        document_store.delete_document(doc_id)
        return jsonify({'success': True, 'message': 'Document deleted'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/documents/<doc_id>/status', methods=['GET'])
def get_document_status(doc_id):
    doc = document_store.get_document(doc_id)
    if not doc:
        return jsonify({'error': 'Document not found'}), 404
    return jsonify({
        'status': doc.status,
        'error_message': doc.error_message,
        'stage': doc.stage,
        'stage_message': doc.stage_message,
        'stage_started_at': doc.stage_started_at,
        'page_count': doc.page_count,
    })


# ============= Session Routes =============

@api_bp.route('/sessions', methods=['GET'])
def list_sessions():
    """List sessions, optionally filtered by mode and/or doc_id."""
    mode = request.args.get('mode')
    doc_id = request.args.get('doc_id')
    items = session_store.list_sessions(mode=mode, doc_id=doc_id)
    return jsonify({'sessions': items})


@api_bp.route('/sessions', methods=['POST'])
def create_session():
    data = request.json or {}
    mode = data.get('mode')
    if mode not in ('single', 'kb'):
        return jsonify({'error': "mode must be 'single' or 'kb'"}), 400
    doc_ids = data.get('doc_ids') or []
    title = data.get('title', '')
    if mode == 'single' and len(doc_ids) != 1:
        return jsonify({'error': 'single-mode session requires exactly one doc_id'}), 400
    if mode == 'kb' and not doc_ids:
        return jsonify({'error': 'kb-mode session requires at least one doc_id'}), 400

    # Validate all docs exist.
    for did in doc_ids:
        if not document_store.get_document(did):
            return jsonify({'error': f'Document {did} not found'}), 404

    session = session_store.create_session(mode=mode, doc_ids=doc_ids, title=title)
    return jsonify({'success': True, 'session': session.to_summary()})


@api_bp.route('/sessions/<session_id>', methods=['GET'])
def get_session(session_id):
    session = session_store.get_session(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    return jsonify({'session': session.to_dict()})


@api_bp.route('/sessions/<session_id>', methods=['PUT'])
def update_session(session_id):
    data = request.json or {}
    kwargs = {}
    if 'title' in data:
        kwargs['title'] = data['title']
    if 'doc_ids' in data:
        kwargs['doc_ids'] = data['doc_ids']
    session = session_store.update_session(session_id, **kwargs)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    return jsonify({'success': True, 'session': session.to_summary()})


@api_bp.route('/sessions/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    ok = session_store.delete_session(session_id)
    if not ok:
        return jsonify({'error': 'Session not found'}), 404
    return jsonify({'success': True})


@api_bp.route('/sessions/<session_id>/clear', methods=['POST'])
def clear_session_messages(session_id):
    if not session_store.get_session(session_id):
        return jsonify({'error': 'Session not found'}), 404
    session_store.clear_messages(session_id)
    return jsonify({'success': True})


# ============= Tree Structure Routes =============

@api_bp.route('/documents/<doc_id>/tree', methods=['GET'])
def get_tree_structure(doc_id):
    tree = document_store.get_tree(doc_id)
    if not tree:
        return jsonify({'error': 'Tree structure not found'}), 404
    from services.rag_service import PageIndexService
    service = PageIndexService(document_store)
    clean_tree = service.remove_fields(tree, ['text'])
    return jsonify({'tree': clean_tree})


@api_bp.route('/documents/<doc_id>/analysis', methods=['GET'])
def get_document_analysis(doc_id):
    doc = document_store.get_document(doc_id)
    if not doc:
        return jsonify({'error': 'Document not found'}), 404
    analysis = document_store.get_analysis(doc_id)
    if not analysis:
        return jsonify({'error': 'Analysis not available yet'}), 404
    return jsonify({'analysis': analysis})


@api_bp.route('/documents/<doc_id>/node-info', methods=['GET'])
def get_node_info(doc_id):
    doc = document_store.get_document(doc_id)
    if not doc:
        return jsonify({'error': 'Document not found'}), 404
    
    tree = document_store.get_tree(doc_id)
    node_map = document_store.get_node_map(doc_id)
    
    if tree and not node_map:
        from services.rag_service import PageIndexService
        service = PageIndexService(document_store)
        page_count = doc.page_count or 0
        if not page_count:
            def count_pages(node):
                max_page = 0
                if isinstance(node, dict):
                    if 'page' in node:
                        max_page = max(max_page, node.get('page', 0))
                    for child in node.get('children', []):
                        max_page = max(max_page, count_pages(child))
                elif isinstance(node, list):
                    for item in node:
                        max_page = max(max_page, count_pages(item))
                return max_page
            page_count = count_pages(tree)
        
        node_map = service.create_node_mapping(tree, include_page_ranges=True, max_page=page_count)
        document_store.cache_node_map(doc_id, node_map)
    
    if not node_map:
        return jsonify({'error': 'Node mapping not available'}), 404
    
    node_info = {}
    for node_id, info in node_map.items():
        node = info.get('node', {})
        node_info[node_id] = {
            'title': node.get('title', ''),
            'summary': node.get('summary', ''),
            'start_index': info.get('start_index'),
            'end_index': info.get('end_index'),
        }
    
    all_pages = []
    page_count = doc.page_count or 0
    for page_num in range(1, page_count + 1):
        page_url = f"/api/results/{doc_id}_{doc.filename}/images/page_{page_num}.jpg"
        all_pages.append({'page': page_num, 'url': page_url})
    
    return jsonify({'node_map': node_info, 'page_count': page_count, 'all_pages': all_pages})


@api_bp.route('/documents/<doc_id>/text-highlights', methods=['GET'])
def get_text_highlights(doc_id):
    doc = document_store.get_document(doc_id)
    if not doc:
        return jsonify({'error': 'Document not found'}), 404
    if doc.status != 'ready':
        return jsonify({'error': 'Document not ready'}), 400

    cache_path = os.path.join(doc.result_dir, 'text_highlights.json')
    if os.path.exists(cache_path):
        with open(cache_path, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))

    node_map = document_store.get_node_map(doc_id)
    if not node_map:
        return jsonify({'error': 'Node mapping not available'}), 404

    from services.rag_service import PageIndexService
    service = PageIndexService(document_store)
    try:
        highlights = service.extract_text_highlights(doc.file_path, node_map)
    except Exception as e:
        logger.error(f"Text highlight extraction error: {e}")
        return jsonify({'error': str(e)}), 500

    try:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(highlights, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Failed to cache highlights: {e}")

    return jsonify(highlights)


# ============= Skill Routes =============

@api_bp.route('/skills', methods=['GET'])
def list_skills():
    skills = skill_manager.list_skills()
    return jsonify({'skills': [s.to_dict() for s in skills]})


@api_bp.route('/skills', methods=['POST'])
def create_skill():
    data = request.json or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Skill name is required'}), 400
    skill = skill_manager.create_skill(
        name=name,
        description=data.get('description', ''),
        content=data.get('content', ''),
        enabled=data.get('enabled', True),
    )
    return jsonify({'success': True, 'skill': skill.to_dict()})


@api_bp.route('/skills/<skill_id>', methods=['GET'])
def get_skill(skill_id):
    skill = skill_manager.get_skill(skill_id)
    if not skill:
        return jsonify({'error': 'Skill not found'}), 404
    return jsonify({'skill': skill.to_dict()})


@api_bp.route('/skills/<skill_id>', methods=['PUT'])
def update_skill(skill_id):
    data = request.json or {}
    skill = skill_manager.update_skill(skill_id, **data)
    if not skill:
        return jsonify({'error': 'Skill not found'}), 404
    return jsonify({'success': True, 'skill': skill.to_dict()})


@api_bp.route('/skills/<skill_id>', methods=['DELETE'])
def delete_skill(skill_id):
    if skill_manager.delete_skill(skill_id):
        return jsonify({'success': True})
    return jsonify({'error': 'Skill not found'}), 404


@api_bp.route('/skills/upload', methods=['POST'])
def upload_skill():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if not file.filename or not file.filename.endswith('.md'):
        return jsonify({'error': 'Only .md files are supported'}), 400

    content = file.read().decode('utf-8')
    skill_id = secure_filename(file.filename)[:-3]
    skill = Skill.from_markdown(content, skill_id)
    skill_manager.save_skill(skill)
    return jsonify({'success': True, 'skill': skill.to_dict()})
