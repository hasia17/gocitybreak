# Deployment

The app runs on one VPS (currently a Mikrus 2.1 trial, server `eve369`; see #14) under Docker Compose, behind Cloudflare.

## How a deploy happens

Every push to `main` runs `.github/workflows/ci.yml`:

1. The backend and frontend tests run. If either fails, nothing is published or deployed.
2. `publish` builds the `linux/amd64` images and pushes them to GHCR as `ghcr.io/hasia17/gocitybreak-{backend,frontend}:<commit SHA>`.
3. `deploy` connects to the server over SSH, uploads `deploy/compose.yml` to `/opt/gocitybreak/compose.yml`, sets `VERSION=<commit SHA>` in `/opt/gocitybreak/.env`, then runs `docker compose pull` and `docker compose up -d`. It waits until `/api/status` reports the new version. If that never happens, the job fails and prints the backend logs.

Images are never built on the server: it has 1 GB of RAM and no swap.

## Server layout

- `/opt/gocitybreak/compose.yml`: a copy of `deploy/compose.yml`, overwritten on every deploy.
- `/opt/gocitybreak/.env`: `POSTGRES_PASSWORD` (exists only here) and `VERSION` (set by the deploy).
- Database data: the `gocitybreak_pgdata` Docker volume.
- Ports:
  - `20369` is reachable from the internet on the shared IPv4 (`http://eve369.mikrus.xyz:20369`).
  - `80` listens on the server's IPv6 only. Cloudflare connects to it with SSL mode "Flexible": HTTPS from visitors to Cloudflare, plain HTTP from Cloudflare to the server.

## GitHub settings the workflow needs

| Kind | Name | Value |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | Private key of a deploy-only ed25519 key; its public key is in `/root/.ssh/authorized_keys` on the server |
| Variable | `DEPLOY_HOST` | `eve369.mikrus.xyz` |
| Variable | `DEPLOY_PORT` | `10369` |
| Variable | `DEPLOY_KNOWN_HOSTS` | The server's host key line, from `ssh-keyscan -p 10369 -t ed25519 eve369.mikrus.xyz` |

The server pulls from GHCR with the deploy job's short-lived `GITHUB_TOKEN` and logs out afterwards, so no registry credentials stay on the server.

## Rolling back

Find the SHA of the last good version: the earlier green CI run on `main`, or `git log`. The deploy log also prints `previous: <SHA>`.

**On the server**, if that image is still there (images newer than 10 days are kept):

```bash
ssh -p 10369 root@eve369.mikrus.xyz
cd /opt/gocitybreak
sed -i 's/^VERSION=.*/VERSION=<good SHA>/' .env
docker compose up -d
curl -s http://localhost:20369/api/status   # shows the version that is running
```

**From GitHub**, if the image is gone from the server: open the CI run of the good commit under Actions, choose "Re-run jobs", and re-run only "Deploy to VPS". That job deploys its own commit's images from GHCR.

The next push to `main` deploys the new commit again.

A rollback doesn't undo database migrations. A migration that the older version can't handle needs a fix forward instead.
