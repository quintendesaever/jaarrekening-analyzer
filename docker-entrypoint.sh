#!/bin/sh
set -e
# Start as root only long enough to make the ratios-data volume writable for the
# non-root app user, then drop privileges with setpriv (util-linux on Debian).
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R app:app /data /app
  exec setpriv --reuid=10001 --regid=10001 --clear-groups -- "$@"
fi
exec "$@"
