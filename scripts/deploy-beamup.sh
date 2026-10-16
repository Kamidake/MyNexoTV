#!/usr/bin/env bash
# Deploy the current main to the public BeamUp instance.
#
# BeamUp is Dokku plus a Docker Swarm cluster. Its cluster only runs apps built
# with the Heroku Node buildpack: an image built from our Dockerfile builds and
# passes Dokku's check, then never answers behind the BeamUp proxy. So this
# script pushes a throwaway commit of main without the Dockerfile.
#
# Access: BeamUp trusts the SSH keys on the joaosavi GitHub account. A new
# machine needs its key on GitHub, then one sync:
#   ssh -i <cli bootstrap key> dokku@a.baby-beamup.club sync-github-keys joaosavi
# (the beamup CLI runs that sync for you on its first deploy).
#
# App config lives on BeamUp, not here. Set once with
#   ssh dokku@a.baby-beamup.club config:set 263f84288ddb/nexotv KEY=value
# Each config:set restarts the app. Values the public instance needs:
#   NODE_OPTIONS=--max-old-space-size=400   heap cap for the small container
#   COREPACK_INTEGRITY_KEYS=0               the buildpack's corepack 0.29 rejects
#                                           current pnpm signatures without it
# plus CONFIG_SECRET and any limits from .env.example.
#
# Logs: ssh dokku@a.baby-beamup.club logs 263f84288ddb-nexotv
set -euo pipefail

HOST=a.baby-beamup.club
APP=263f84288ddb/nexotv
REF=${1:-origin/main}

cd "$(git rev-parse --show-toplevel)"
git fetch --quiet origin
git remote get-url beamup >/dev/null 2>&1 || git remote add beamup "dokku@$HOST:$APP"

WORKTREE=$(mktemp -d)
trap 'git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true' EXIT
git worktree add --quiet --detach "$WORKTREE" "$REF"
git -C "$WORKTREE" rm --quiet Dockerfile
git -C "$WORKTREE" -c user.name=deploy -c user.email=deploy@localhost \
    commit --quiet -m "deploy: $(git rev-parse --short "$REF") without Dockerfile for BeamUp"

git -C "$WORKTREE" push beamup HEAD:master --force
echo "Deployed $(git rev-parse --short "$REF"). Check: curl https://263f84288ddb-nexotv.baby-beamup.club/health"
