#!/bin/bash

# Vimflowy startup script

echo "Starting Vimflowy..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Please copy .env.example to .env and configure it."
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Check required environment variables
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not set in .env"
    exit 1
fi

if [ -z "$GOOGLE_CLIENT_ID" ]; then
    echo "Error: GOOGLE_CLIENT_ID not set in .env"
    exit 1
fi

if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
    echo "Error: GOOGLE_CLIENT_SECRET not set in .env"
    exit 1
fi

# Build if build directory doesn't exist
if [ ! -d "build" ]; then
    echo "Building application..."
    npm run build
fi

# Start the server
echo "Starting server on http://localhost:3000"
npm run startprod -- --db postgres --host localhost --port 3000
