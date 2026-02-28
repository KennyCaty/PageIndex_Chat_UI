#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Configuration management for PageIndex Chat UI

This module provides:
- Default configurations (hardcoded, safe for Git)
- Runtime configuration management (saved to config.json, gitignored)
"""

import os
import json
from typing import Dict, Optional
from dataclasses import dataclass, field, asdict
from pathlib import Path

CONFIG_FILE = Path(__file__).parent / 'config.json'

# ============================================================
# Default Server Configuration (hardcoded defaults)
# ============================================================
DEFAULT_SERVER_CONFIG = {
    'secret_key': 'pageindex-chat-secret-key-2025',
    'host': '0.0.0.0',
    'port': 5001,
    'debug': True
}

# ============================================================
# Default Model Configurations (hardcoded defaults)
# ============================================================
DEFAULT_MODELS = {
    'text': {
        'name': 'gpt-4o-mini',
        'api_key': '',
        'base_url': 'https://api.openai.com/v1',
        'type': 'text'
    },
    'vision': {
        'name': 'gpt-4.1',
        'api_key': '',
        'base_url': 'https://api.openai.com/v1',
        'type': 'vision'
    }
}

@dataclass
class ModelConfig:
    """Model configuration"""
    name: str
    api_key: str
    base_url: str
    model_type: str  # 'text' or 'vision'

@dataclass
class AppConfig:
    """Application configuration"""
    models: Dict[str, Dict] = field(default_factory=lambda: DEFAULT_MODELS.copy())
    default_model_type: str = 'text'
    
    def to_dict(self):
        return asdict(self)

class ConfigManager:
    """Configuration manager for storing and retrieving settings"""
    
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
        self.config = self._load_config()
    
    def _load_config(self) -> AppConfig:
        """Load configuration from file or create default"""
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, 'r') as f:
                    data = json.load(f)
                # Filter out unknown keys for backward compatibility
                known_keys = {'models', 'default_model_type'}
                filtered_data = {k: v for k, v in data.items() if k in known_keys}
                return AppConfig(**filtered_data)
            except Exception as e:
                print(f"Error loading config: {e}")
        return AppConfig()
    
    def _save_config(self):
        """Save configuration to file"""
        try:
            with open(CONFIG_FILE, 'w') as f:
                json.dump(self.config.to_dict(), f, indent=2)
        except Exception as e:
            print(f"Error saving config: {e}")
    
    # ============================================================
    # Model Configuration Methods
    # ============================================================
    
    def get_model_config(self, model_type: str) -> Dict:
        """Get model configuration by type"""
        return self.config.models.get(model_type, DEFAULT_MODELS.get(model_type, {}))
    
    def set_model_config(self, model_type: str, config: Dict):
        """Set model configuration"""
        self.config.models[model_type] = config
        self._save_config()
    
    def get_all_models(self) -> Dict:
        """Get all model configurations"""
        return self.config.models
    
    def get_default_model_type(self) -> str:
        """Get default model type"""
        return self.config.default_model_type
    
    def set_default_model_type(self, model_type: str):
        """Set default model type"""
        self.config.default_model_type = model_type
        self._save_config()
    
    # ============================================================
    # Server Configuration Methods (returns defaults, not saved)
    # ============================================================
    
    def get_secret_key(self) -> str:
        """Get secret key for Flask session"""
        return DEFAULT_SERVER_CONFIG['secret_key']
    
    def get_host(self) -> str:
        """Get server host"""
        return DEFAULT_SERVER_CONFIG['host']
    
    def get_port(self) -> int:
        """Get server port"""
        return DEFAULT_SERVER_CONFIG['port']
    
    def get_debug(self) -> bool:
        """Get debug mode"""
        return DEFAULT_SERVER_CONFIG['debug']

# Global config instance
config_manager = ConfigManager()
