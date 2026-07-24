#!/usr/bin/env bash

# Intended to run on the Kubuntu deployment server, not in local dev (WSL2).
# Pulls the latest built image from the registry and (re)starts the container.
#
# Expected environment variables (set in the shell or in a ./.env file next
# to this script, which is sourced automatically if present):
#   POSTGRES_PASSWORD  required - superuser password for the database
#   POSTGRES_USER      optional - superuser name, defaults to "postgres"
#   POSTGRES_DB        optional - default database name, defaults to POSTGRES_USER

# Exit immediately if a command exits with a non-zero status
set -e

# --- CONFIGURATION ---
REGISTRY="mnserver.internal:5000"
IMAGE_NAME="utmimic-database"
IMAGE_TAG="latest"
CONTAINER_NAME="utmimic-database"
VOLUME_NAME="utmimic-database-data"
HOST_PORT=5432

# Full image reference required by registries
FULL_IMAGE_REF="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

# --- CREDENTIALS ---
# Load POSTGRES_PASSWORD (and optionally POSTGRES_USER / POSTGRES_DB) from an
# env file kept out of version control, if present alongside this script.
ENV_FILE="$(dirname "$0")/.env"
if [ -f "${ENV_FILE}" ]; then
	# shellcheck disable=SC1090
	source "${ENV_FILE}"
fi

if [ -z "${POSTGRES_PASSWORD}" ]; then
	echo "❌ POSTGRES_PASSWORD is not set. Export it or put it in $(dirname "$0")/.env"
	exit 1
fi

echo "========================================="
echo "🚀 Deploying ${FULL_IMAGE_REF}"
echo "Container: ${CONTAINER_NAME}"
echo "========================================="

# Step 1: Pull the latest image from the registry
echo "📥 Pulling image..."
docker pull "${FULL_IMAGE_REF}"

# Step 2: Ensure the persistent data volume exists (no-op if it already does)
echo "💾 Ensuring data volume exists..."
docker volume create "${VOLUME_NAME}" >/dev/null

# Step 3: Replace any existing container (data lives in the volume, not the container)
if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
	echo "🛑 Stopping and removing existing container..."
	docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

# Step 4: Run the container
echo "▶️ Starting container..."
docker run -d \
	--name "${CONTAINER_NAME}" \
	--restart unless-stopped \
	-p "${HOST_PORT}:5432" \
	-v "${VOLUME_NAME}:/pgdata" \
	-e PGDATA=/pgdata/data \
	-e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
	${POSTGRES_USER:+-e POSTGRES_USER="${POSTGRES_USER}"} \
	${POSTGRES_DB:+-e POSTGRES_DB="${POSTGRES_DB}"} \
	"${FULL_IMAGE_REF}"

echo "========================================="
echo "✅ Success! ${CONTAINER_NAME} is running on port ${HOST_PORT}."
echo "Logs: docker logs -f ${CONTAINER_NAME}"
echo "========================================="
