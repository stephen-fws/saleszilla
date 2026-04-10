#!/bin/bash
# Deploy Salezilla to Google Cloud Run
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Docker installed (or use Cloud Build)
#   - Set your project: gcloud config set project YOUR_PROJECT_ID
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
API_SERVICE="salezilla-api"
UI_SERVICE="salezilla-ui"
API_IMAGE="gcr.io/${PROJECT_ID}/${API_SERVICE}"
UI_IMAGE="gcr.io/${PROJECT_ID}/${UI_SERVICE}"

echo "=========================================="
echo "Deploying Salezilla to Cloud Run"
echo "Project: ${PROJECT_ID}"
echo "Region:  ${REGION}"
echo "=========================================="

# ── Step 1: Deploy API ────────────────────────────────────────────────────────
echo ""
echo ">> Building and deploying API..."
cd api
gcloud run deploy ${API_SERVICE} \
  --source=. \
  --region=${REGION} \
  --platform=managed \
  --allow-unauthenticated \
  --port=8000 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=300
cd ..

# Get the API URL
API_URL=$(gcloud run services describe ${API_SERVICE} --region=${REGION} --format='value(status.url)')
echo ">> API deployed at: ${API_URL}"

# ── Step 2: Deploy UI ────────────────────────────────────────────────────────
echo ""
echo ">> Building and deploying UI (with API_URL=${API_URL})..."
cd ui

# Build locally with the correct API URL baked in
docker build \
  --build-arg VITE_API_BASE_URL=${API_URL} \
  -t ${UI_IMAGE}:latest \
  .

# Push to GCR
docker push ${UI_IMAGE}:latest

# Deploy to Cloud Run
gcloud run deploy ${UI_SERVICE} \
  --image=${UI_IMAGE}:latest \
  --region=${REGION} \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=256Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=2

cd ..

UI_URL=$(gcloud run services describe ${UI_SERVICE} --region=${REGION} --format='value(status.url)')

echo ""
echo "=========================================="
echo "Deployment complete!"
echo "=========================================="
echo "API: ${API_URL}"
echo "UI:  ${UI_URL}"
echo ""
echo "Next steps:"
echo "  1. Set API environment variables:"
echo "     gcloud run services update ${API_SERVICE} --region=${REGION} --set-env-vars='MSSQL_SERVER=...,JWT_ACCESS_SECRET_KEY=...'"
echo "  2. Update FRONTEND_URL on the API:"
echo "     gcloud run services update ${API_SERVICE} --region=${REGION} --update-env-vars='FRONTEND_URL=${UI_URL}'"
echo "  3. Update BASE_URL for Twilio webhooks:"
echo "     gcloud run services update ${API_SERVICE} --region=${REGION} --update-env-vars='BASE_URL=${API_URL}'"
echo "  4. Re-run setup_twilio.py with the new BASE_URL if needed"
echo "=========================================="
