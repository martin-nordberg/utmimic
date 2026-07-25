#!/usr/bin/env bash

# Intended to run on the Kubuntu deployment server, not in local dev (WSL2).
# Pulls the latest built image from the registry and (re)starts the container.

# Exit immediately if a command exits with a non-zero status
set -e

# --- CONFIGURATION ---
REGISTRY="mnserver.internal:5000"
IMAGE_NAME="utmimic-documentation"
IMAGE_TAG="latest"
CONTAINER_NAME="utmimic-documentation"
HOST_PORT=443

# Full image reference required by registries
FULL_IMAGE_REF="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "========================================="
echo "🚀 Deploying ${FULL_IMAGE_REF}"
echo "Container: ${CONTAINER_NAME}"
echo "========================================="

# Step 1: Pull the latest image from the registry
echo "📥 Pulling image..."
docker pull "${FULL_IMAGE_REF}"

# Step 2: Replace any existing container
if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
	echo "🛑 Stopping and removing existing container..."
	docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

# Step 3: Run the container
echo "▶️ Starting container..."
docker run -d \
	--name "${CONTAINER_NAME}" \
	--restart unless-stopped \
	-p "${HOST_PORT}:443" \
	"${FULL_IMAGE_REF}"

echo "========================================="
echo "✅ Success! ${CONTAINER_NAME} is running on port ${HOST_PORT}."
echo "Logs: docker logs -f ${CONTAINER_NAME}"
echo "========================================="
