#!/usr/bin/env bash

# Intended to run on the Kubuntu deployment server, not in local dev (WSL2).
# Stops and removes every container in the stack. The database's data
# volume (utmimic-database-data) is not touched, so data survives.

# Exit immediately if a command exits with a non-zero status
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"

echo "========================================="
echo "🛑 Stopping the utmimic stack"
echo "========================================="

docker compose -f "${COMPOSE_FILE}" down

echo "========================================="
echo "✅ Stack stopped. Data volume left intact."
echo "========================================="
