#!/usr/bin/env bash

# Intended to run on the Kubuntu deployment server, not in local dev (WSL2).
# Starts a second, dev/test Postgres instance alongside the primary one from
# run-docker.sh — same image, but its own container/port, so services'
# integration tests can freely drop and re-migrate their own schemas here
# without touching the primary instance's data.
#
# Deliberately has NO persistent volume: data is ephemeral, living only in
# the container's writable layer. Recreating the container (which this
# script always does) or losing the container for any other reason wipes
# it back to an empty database — desired here, since this instance's entire
# purpose is being freely reset by test runs.
#
# Expected environment variables (set in the shell or in a ./.env file next
# to this script, which is sourced automatically if present — same file
# run-docker.sh uses):
#   POSTGRES_PASSWORD  required - superuser password for the database
#   POSTGRES_USER      optional - superuser name, defaults to "postgres"
#   POSTGRES_DB        optional - default database name, defaults to POSTGRES_USER

# Exit immediately if a command exits with a non-zero status
set -e

# --- CONFIGURATION ---
REGISTRY="mnserver.internal:5000"
IMAGE_NAME="utmimic-database"
IMAGE_TAG="latest"
CONTAINER_NAME="utmimic-database-dev"
HOST_PORT=5431

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
echo "🚀 Deploying ${FULL_IMAGE_REF} (dev/test instance)"
echo "Container: ${CONTAINER_NAME}"
echo "========================================="

# Step 1: Pull the latest image from the registry
echo "📥 Pulling image..."
docker pull "${FULL_IMAGE_REF}"

# Step 2: Replace any existing container — this is also how data gets wiped,
# since there's no volume backing it (see header comment)
if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
	echo "🛑 Stopping and removing existing container..."
	docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

# Step 3: Run the container (no -v: ephemeral data in the container's own layer)
echo "▶️ Starting container..."
docker run -d \
	--name "${CONTAINER_NAME}" \
	--restart unless-stopped \
	-p "${HOST_PORT}:5432" \
	-e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
	${POSTGRES_USER:+-e POSTGRES_USER="${POSTGRES_USER}"} \
	${POSTGRES_DB:+-e POSTGRES_DB="${POSTGRES_DB}"} \
	"${FULL_IMAGE_REF}"

echo "========================================="
echo "✅ Success! ${CONTAINER_NAME} is running on port ${HOST_PORT}."
echo "Logs: docker logs -f ${CONTAINER_NAME}"
echo "========================================="
