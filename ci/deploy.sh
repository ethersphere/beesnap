#!/bin/bash
# /var/www/beesnap/deploy.sh

# Log function
log_message() {
  echo "[$(date -Iseconds)] $1" >> /var/www/beesnap/deploy-log.txt
}

log_message "Starting deployment"

# Navigate to app directory
cd /var/www/beesnap
log_message "Pulling latest changes"
git pull

# Install dependencies and build
log_message "Installing dependencies"
npm ci
log_message "Building application"
npm run build

# Restart the application
log_message "Stopping existing screen session"
screen -S beesnap -X quit > /dev/null 2>&1 || true
log_message "Starting new screen session"
screen -dmS beesnap bash -c "cd /var/www/beesnap/backend && node index.js > backend.log 2>&1"

# Check if screen session was created
if screen -list | grep -q "beesnap"; then
  log_message "Screen session 'beesnap' started successfully"
else
  log_message "ERROR: Failed to start screen session 'beesnap'"
fi

log_message "Deployment completed"
