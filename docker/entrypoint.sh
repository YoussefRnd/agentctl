#!/bin/sh
set -eu

# nginx writes its pid and temp files here because the container runs as uid 1000.
mkdir -p /tmp/client_body /tmp/proxy /tmp/fastcgi /tmp/uwsgi /tmp/scgi

# nginx daemonizes so the Node server can stay PID 1 and receive stop signals
# for its graceful shutdown hooks.
nginx

exec node apps/server/dist/src/index.js
