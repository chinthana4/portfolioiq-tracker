#!/bin/bash
set -e
BASE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing backend dependencies..."
cd "$BASE/backend" && npm install

echo "==> Installing frontend dependencies..."
cd "$BASE/frontend" && npm install

echo ""
echo "==> Starting backend (port 3001)..."
cd "$BASE/backend" && npm start &
BACKEND_PID=$!

echo "==> Starting frontend (port 5173)..."
cd "$BASE/frontend" && npm run dev &
FRONTEND_PID=$!

echo ""
echo "✓ App running at http://localhost:5173"
echo "  Backend API at http://localhost:3001/api/health"
echo "  Press Ctrl+C to stop both servers."
echo ""

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
