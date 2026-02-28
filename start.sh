#!/bin/bash
# PageIndex Chat UI Startup Script (using uv with Python 3.11)

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Unset external VIRTUAL_ENV to avoid conflicts
unset VIRTUAL_ENV

# Set up environment
export PYTHONPATH="${PYTHONPATH}:$(dirname "$SCRIPT_DIR")"

# Copy .env.example to .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env file from .env.example"
fi

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "uv is not installed. Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# Create virtual environment and install dependencies using uv
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment with uv (Python 3.11)..."
    uv venv --python 3.11
fi

echo "Installing/updating dependencies with uv..."
uv sync

# Start the server
echo "Starting PageIndex Chat UI..."
uv run python app.py
