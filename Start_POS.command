#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================="
echo " Starting Food POS System..."
echo "=========================================="

if [ -f ".venv/bin/python" ]; then
    .venv/bin/python app.py
elif command -v python3 >/dev/null 2>&1; then
    python3 app.py
else
    echo "[Error] Python 3 not found."
    read -p "Press Enter to exit..."
    exit 1
fi

if [ $? -ne 0 ]; then
    echo ""
    echo "[Error] Failed to start Food POS."
    read -p "Press Enter to close..."
fi
