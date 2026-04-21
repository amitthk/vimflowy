#!/bin/bash

# Vimflowy startup script

echo "================================"
echo "  Vimflowy Startup Script"
echo "================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    echo "  # Then edit .env with your settings"
    exit 1
fi

# Load environment variables
set -a
. ./.env
set +a

# Check required environment variables
if [ -z "$DIRECTUS_STATIC_URL" ]; then
    echo "❌ Error: DIRECTUS_STATIC_URL not set in .env"
    exit 1
fi

if [ -z "$DIRECTUS_STATIC_TOKEN" ]; then
    echo "❌ Error: DIRECTUS_STATIC_TOKEN not set in .env"
    exit 1
fi

if [ -z "$DIRECTUS_ADMIN_TOKEN" ]; then
    echo "⚠️  Warning: DIRECTUS_ADMIN_TOKEN is not set."
    echo "   Schema bootstrap script may fail if collections are missing."
fi

if [ -z "$PORT" ]; then
    PORT=8300
fi

if [ -z "$HOST" ]; then
    HOST=localhost
fi

echo "✅ Environment variables loaded"
echo ""

echo "Initializing Directus schema (idempotent)..."
node scripts/setup-directus.mjs
if [ $? -ne 0 ]; then
    echo "❌ Directus setup failed!"
    exit 1
fi

echo "✅ Directus schema ready"
echo ""

# Build if build directory doesn't exist
if [ ! -d "build" ]; then
    echo "📦 Build directory not found, building application..."
    npm run build
    if [ $? -ne 0 ]; then
        echo "❌ Build failed!"
        exit 1
    fi
    echo "✅ Build complete"
else
    echo "✅ Build directory exists"
fi
echo ""

# Start the server
echo "🚀 Starting server..."
echo "   URL: http://${HOST}:${PORT}"
echo "   Login page: http://${HOST}:${PORT}/login.html"
echo ""
echo "Press Ctrl+C to stop the server"
echo "================================"
echo ""

npm run startprod -- --host "$HOST" --port "$PORT"
