#!/usr/bin/env bash

# Intended to run on the Kubuntu deployment server, not in local dev (WSL2).
# Pulls the latest built images for every module from the registry and
# (re)starts the whole stack via docker compose.
#
# Expected environment variables (set in the shell or in a ./.env file next
# to this script, which is sourced automatically if present):
#   POSTGRES_PASSWORD  required - superuser password for the database
#   POSTGRES_USER      optional - superuser name, defaults to "postgres"
#   POSTGRES_DB        optional - default database name, defaults to "postgres"
#   LOG_LEVEL          optional - log level shared by all services, defaults to "info"

# Exit immediately if a command exits with a non-zero status
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"

# --- CREDENTIALS ---
# Load POSTGRES_PASSWORD (and optionally the other vars above) from an env
# file kept out of version control, if present alongside this script.
ENV_FILE="${SCRIPT_DIR}/.env"
if [ -f "${ENV_FILE}" ]; then
	# shellcheck disable=SC1090
	source "${ENV_FILE}"
fi

if [ -z "${POSTGRES_PASSWORD}" ]; then
	echo "❌ POSTGRES_PASSWORD is not set. Export it or put it in ${SCRIPT_DIR}/.env"
	exit 1
fi

echo "========================================="
echo "🚀 Deploying the utmimic stack"
echo "========================================="

# Step 1: Pull the latest images from the registry
echo "📥 Pulling images..."
docker compose -f "${COMPOSE_FILE}" pull

# Step 2: Start (or recreate) every container
echo "▶️ Starting containers..."
docker compose -f "${COMPOSE_FILE}" up -d

echo "========================================="
echo "✅ Success! The utmimic stack is running."
echo "Logs: docker compose -f ${COMPOSE_FILE} logs -f"
echo "========================================="
