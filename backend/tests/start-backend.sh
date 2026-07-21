#!/bin/bash
# R93 backend start script — reads secrets from server .env and adds dev flag.
# Local-then-upload pattern: secrets never appear in command line.
set -e
cd /opt/resume-app/backend

# Read existing env values from .env (already has DB_USER/DB_PASSWORD/REDIS_PASSWORD)
set -a
. ./.env
set +a

# Add dev flag
export ENABLE_DEV_ENDPOINTS=1

# Stop existing process
pm2 delete resume-app-backend 2>/dev/null || true

# Start with full env
pm2 start ecosystem.config.js --only resume-app-backend --env production --update-env

# Verify
sleep 4
pm2 list | grep resume-app
curl -sS http://127.0.0.1:3003/api/health/live -w '\nhealth: %{http_code}\n'