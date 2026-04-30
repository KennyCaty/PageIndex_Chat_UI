#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Socket.IO event handlers for streaming chat (session-based).
"""

import json
import logging
import asyncio
from flask_socketio import emit
from flask import request

from models.session import session_store
from services.rag_service import rag_service

logger = logging.getLogger(__name__)

_cancel_flags: dict[str, bool] = {}


def _is_cancelled(sid: str) -> bool:
    return _cancel_flags.get(sid, False)


def _clear_cancel(sid: str):
    _cancel_flags.pop(sid, None)


def _process_chunk(chunk):
    """Parse a streaming chunk and emit the appropriate socket event.
    Returns True if the chunk was a special marker, False if plain text."""
    c = chunk.strip()

    if c.startswith('[SEARCHING]'):
        emit('status', {'status': 'searching'})
    elif c.startswith('[PREPARING]'):
        emit('status', {'status': 'preparing'})
    elif c.startswith('[PREPARED]'):
        emit('status', {'status': 'prepared'})
    elif c.startswith('[THINKING_CHUNK]'):
        emit('thinking_chunk', {'content': c.replace('[THINKING_CHUNK]', '')})
    elif c.startswith('[THINKING]'):
        emit('thinking', {'content': c.replace('[THINKING]', '').strip()})
    elif c.startswith('[NODES]'):
        nodes_str = c.replace('[NODES]', '').strip()
        try:
            nodes = json.loads(nodes_str)
            emit('nodes', {'nodes': nodes})
        except Exception:
            pass
    elif c.startswith('[ANSWERING]'):
        emit('status', {'status': 'answering'})
    elif c.startswith('[AGENT_STEP]'):
        payload = c.replace('[AGENT_STEP]', '').strip()
        try:
            emit('agent_step', json.loads(payload))
        except Exception:
            emit('agent_step', {'raw': payload})
    elif c.startswith('[AGENT_DECOMPOSE]'):
        payload = c.replace('[AGENT_DECOMPOSE]', '').strip()
        try:
            emit('agent_decompose', json.loads(payload))
        except Exception:
            emit('agent_decompose', {'raw': payload})
    elif c.startswith('[AGENT_REFLECT]'):
        payload = c.replace('[AGENT_REFLECT]', '').strip()
        try:
            emit('agent_reflect', json.loads(payload))
        except Exception:
            emit('agent_reflect', {'raw': payload})
    elif c.startswith('[AGENT_RETRY]'):
        emit('status', {'status': 'retrying'})
    elif c.startswith('[RETRY_ANSWERING]'):
        emit('status', {'status': 'retry_answering'})
    elif c.startswith('[Error'):
        emit('error', {'message': c})
    else:
        return False
    return True


def _run_stream(stream_fn, sid: str):
    """Boilerplate: consume an async generator and relay chunks via socket.

    The async generator runs as an asyncio.Task; a background watcher task
    polls the cancel flag and cancels the main task immediately when the
    client hits Stop — so we don't have to wait for the next yield (which
    may be blocked in a long LLM call).
    """
    async def runner():
        stopped = False

        async def consume():
            async for chunk in stream_fn():
                if _is_cancelled(sid):
                    break
                if not _process_chunk(chunk):
                    emit('chunk', {'content': chunk})

        async def watch_cancel(task: asyncio.Task):
            # Poll the cancel flag frequently so Stop feels instant even
            # while the producer is blocked inside an LLM call.
            while not task.done():
                if _is_cancelled(sid):
                    task.cancel()
                    return
                await asyncio.sleep(0.1)

        main_task = asyncio.create_task(consume())
        watcher = asyncio.create_task(watch_cancel(main_task))
        try:
            await main_task
        except asyncio.CancelledError:
            stopped = True
        except Exception as e:
            logger.error(f"Stream error: {e}")
            emit('error', {'message': str(e)})
            watcher.cancel()
            return
        finally:
            watcher.cancel()
            try:
                await watcher
            except (asyncio.CancelledError, Exception):
                pass

        if _is_cancelled(sid):
            stopped = True

        if stopped:
            emit('stopped', {'status': 'stopped'})
        else:
            emit('done', {'status': 'completed'})

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(runner())
    finally:
        _clear_cancel(sid)
        loop.close()


def register_socket_events(socketio):
    """Register Socket.IO event handlers"""

    @socketio.on('connect')
    def handle_connect():
        logger.info(f"Client connected: {request.sid}")
        emit('connected', {'status': 'connected'})

    @socketio.on('disconnect')
    def handle_disconnect():
        logger.info(f"Client disconnected: {request.sid}")
        _clear_cancel(request.sid)

    @socketio.on('stop_generating')
    def handle_stop_generating():
        sid = request.sid
        logger.info(f"Stop requested by {sid}")
        _cancel_flags[sid] = True

    # ------------------------------------------------------------------ #
    #  Legacy simple RAG (session-based, single-doc only)
    # ------------------------------------------------------------------ #
    @socketio.on('chat')
    def handle_chat(data):
        session_id = data.get('session_id')
        query = data.get('query')
        model_type = data.get('model_type', 'text')
        use_memory = data.get('use_memory', True)

        if not session_id or not query:
            emit('error', {'message': 'Missing session_id or query'})
            return

        session = session_store.get_session(session_id)
        if not session:
            emit('error', {'message': 'Session not found'})
            return

        sid = request.sid
        _clear_cancel(sid)
        logger.info(f"Chat - session: {session_id}, query: {query[:50]}..., model: {model_type}")

        def stream_fn():
            return rag_service.chat_stream(session_id, query, model_type, use_memory)

        _run_stream(stream_fn, sid)

    # ------------------------------------------------------------------ #
    #  Agent chat (session-based, supports single + kb modes)
    # ------------------------------------------------------------------ #
    @socketio.on('agent_chat')
    def handle_agent_chat(data):
        session_id = data.get('session_id')
        query = data.get('query')
        model_type = data.get('model_type', 'text')
        use_memory = data.get('use_memory', True)

        if not session_id or not query:
            emit('error', {'message': 'Missing session_id or query'})
            return

        session = session_store.get_session(session_id)
        if not session:
            emit('error', {'message': 'Session not found'})
            return

        sid = request.sid
        _clear_cancel(sid)
        logger.info(
            f"Agent chat - session: {session_id} ({session.mode}, "
            f"{len(session.doc_ids)} docs), query: {query[:50]}..."
        )

        def stream_fn():
            return rag_service.agent_chat_stream(session_id, query, model_type, use_memory)

        _run_stream(stream_fn, sid)

    # ------------------------------------------------------------------ #
    #  Vision model non-streaming path (kept for compatibility)
    # ------------------------------------------------------------------ #
    @socketio.on('chat_sync')
    def handle_chat_sync(data):
        session_id = data.get('session_id')
        query = data.get('query')
        model_type = data.get('model_type', 'vision')
        use_memory = data.get('use_memory', True)
        use_agent = data.get('use_agent', False)

        if not session_id or not query:
            emit('error', {'message': 'Missing session_id or query'})
            return

        session = session_store.get_session(session_id)
        if not session:
            emit('error', {'message': 'Session not found'})
            return

        sid = request.sid
        _clear_cancel(sid)

        async def get_response():
            stopped = False
            full_response = ""

            async def consume():
                nonlocal full_response
                stream_fn = (
                    rag_service.agent_chat_stream if use_agent
                    else rag_service.chat_stream
                )
                async for chunk in stream_fn(session_id, query, model_type, use_memory):
                    if _is_cancelled(sid):
                        break
                    if not _process_chunk(chunk):
                        full_response += chunk

            async def watch_cancel(task: asyncio.Task):
                while not task.done():
                    if _is_cancelled(sid):
                        task.cancel()
                        return
                    await asyncio.sleep(0.1)

            main_task = asyncio.create_task(consume())
            watcher = asyncio.create_task(watch_cancel(main_task))
            try:
                await main_task
            except asyncio.CancelledError:
                stopped = True
            except Exception as e:
                logger.error(f"Response error: {e}")
                emit('error', {'message': str(e)})
                watcher.cancel()
                return
            finally:
                watcher.cancel()
                try:
                    await watcher
                except (asyncio.CancelledError, Exception):
                    pass

            if _is_cancelled(sid):
                stopped = True

            if stopped:
                if full_response:
                    emit('response', {'content': full_response})
                emit('stopped', {'status': 'stopped'})
            else:
                emit('response', {'content': full_response})
                emit('done', {'status': 'completed'})

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(get_response())
        finally:
            _clear_cancel(sid)
            loop.close()

    # ------------------------------------------------------------------ #
    #  History (session-based)
    # ------------------------------------------------------------------ #
    @socketio.on('get_history')
    def handle_get_history(data):
        session_id = data.get('session_id')
        if not session_id:
            emit('error', {'message': 'Missing session_id'})
            return
        history = rag_service.get_session_history(session_id)
        emit('history', {'history': history, 'session_id': session_id})

    @socketio.on('clear_history')
    def handle_clear_history(data):
        session_id = data.get('session_id')
        if not session_id:
            emit('error', {'message': 'Missing session_id'})
            return
        rag_service.clear_session_history(session_id)
        emit('history_cleared', {'session_id': session_id})
