#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# --- CONFIGURATION ---
REGISTRY="mnserver.internal:5000"
IMAGE_NAME="utmimic-database"
IMAGE_TAG="latest"

# Full image reference required by registries
FULL_IMAGE_REF="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "========================================="
echo "🚀 Starting Build & Register Process"
echo "Target: ${FULL_IMAGE_REF}"
echo "========================================="

# Step 1: Build the image using the local Dockerfile
echo "🏗️ Building Docker image..."
docker build -t "${FULL_IMAGE_REF}" .

# Step 2: Register/Push the image to the registry
echo "📦 Registering image to the registry..."
docker push "${FULL_IMAGE_REF}"

echo "========================================="
echo "✅ Success! Image is registered."
echo "Run it using: docker run ${FULL_IMAGE_REF}"
echo "========================================="
