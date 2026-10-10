# ---------------------------------------------------------------------------
# Saba POS
# ---------------------------------------------------------------------------
# One stage, because there is nothing to build: no bundler, no transpiler, no
# dependencies to install. The image is the source plus a Node runtime.
#
# The Node version is pinned deliberately. The database runs on node:sqlite,
# which Node still marks experimental — pinning the runtime is what turns that
# from a risk into a known quantity, and it is why the image is rebuilt and
# re-tested rather than tracking `node:22` as it moves.
# ---------------------------------------------------------------------------

FROM node:22.22.0-alpine

# tini reaps zombies and forwards SIGTERM, so `docker stop` reaches the
# server's own shutdown path and the database is closed cleanly.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    SABA_HOST=0.0.0.0 \
    SABA_PORT=8080 \
    SABA_DATA_DIR=/data

WORKDIR /srv/saba

# Only what the server actually serves and runs.
COPY package.json ./
COPY server ./server
COPY app ./app
COPY tools ./tools
COPY docs ./docs
COPY README.md LICENSE.txt ./

# The database lives outside the image. Back up this one directory and you
# have backed up the restaurant.
RUN mkdir -p /data && chown -R node:node /data /srv/saba
VOLUME ["/data"]

USER node
EXPOSE 8080

# No shell in the health check: a POS should not depend on busybox staying put.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SABA_PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/main.js"]
