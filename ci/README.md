# CI / deploy

Deployment script and webhook notes for this repo’s server.

## `deploy.sh`

Make it executable so the webhook can run it:

```bash
chmod +x ci/deploy.sh
```

## Webhook

1. Add a `ci/.env` file (do not commit secrets) with `WEBHOOK_SECRET=...`.
2. In the GitHub repo: **Settings → Webhooks**, point the hook at your server endpoint that runs the deploy script with the same secret.

Adjust paths if your checkout lives somewhere other than `/var/www/beesnap` (see any hardcoded paths in `deploy.sh`).
