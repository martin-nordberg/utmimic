#!/usr/bin/env bash

# Intended to run in local dev (WSL2), not on the Kubuntu deployment server.
# Sequences every module's own build-docker.sh so the whole stack's images
# can be rebuilt and pushed to the registry with one command. Does not
# duplicate any build logic itself - each module's script remains the only
# place that knows how to build that module's image.

# Exit immediately if a command exits with a non-zero status
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

MODULES=(
	database
	weather_service
	drone_registrations_service
	flight_authorizations_service
	live_flight_log_service
	sensor_flight_log_service
)

for module in "${MODULES[@]}"; do
	echo "========================================="
	echo "🏗️  Building ${module}"
	echo "========================================="
	(cd "${REPO_ROOT}/${module}" && ./build-docker.sh)
done

echo "========================================="
echo "✅ All images built and pushed."
echo "========================================="
