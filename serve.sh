#!/usr/bin/env bash
# Serve the Verilens demo site locally and print the exact URL to open.
# Usage: ./serve.sh   (Ctrl+C to stop)
PORT="${1:-8000}"
URL="http://localhost:${PORT}/website/index.html"
echo "Verilens site running → ${URL}"
echo "(Ctrl+C to stop)"
exec python3 -m http.server "${PORT}"
