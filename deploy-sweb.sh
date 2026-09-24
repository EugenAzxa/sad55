#!/usr/bin/env bash
# Upload the site to SpaceWeb over FTP.
#
# One-time setup: create .ftp-credentials next to this script with
#   FTP_HOST=ftp.sad56.spb.ru
#   FTP_USER=your_login
#   FTP_PASS=your_password
#   FTP_DIR=/sad56.spb.ru/public_html
# then:  chmod 600 .ftp-credentials
# It is gitignored, so the password never reaches the repository.
#
# Usage:  ./deploy-sweb.sh          upload everything
#         ./deploy-sweb.sh --dry    list what would be sent

set -euo pipefail
cd "$(dirname "$0")"

[ -f .ftp-credentials ] || { echo "missing .ftp-credentials - see the header of this script"; exit 1; }
# shellcheck disable=SC1091
source .ftp-credentials
: "${FTP_HOST:?}" "${FTP_USER:?}" "${FTP_PASS:?}" "${FTP_DIR:?}"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

for f in *.html robots.txt sitemap.xml manifest.json sw.js favicon.svg .htaccess; do
  [ -f "$f" ] && cp "$f" "$STAGE/"
done
mkdir -p "$STAGE/assets"
cp -R assets/css assets/js assets/img "$STAGE/assets/"
cp assets/*.svg "$STAGE/assets/" 2>/dev/null || true

COUNT=$(find "$STAGE" -type f | wc -l | tr -d ' ')
SIZE=$(du -sh "$STAGE" | cut -f1)
echo "staged $COUNT files ($SIZE) -> $FTP_HOST$FTP_DIR"

if [ "${1:-}" = "--dry" ]; then
  find "$STAGE" -type f | sed "s|$STAGE/|  |" | sort
  exit 0
fi

if command -v lftp >/dev/null 2>&1; then
  lftp -c "set ftp:ssl-allow true; set ssl:verify-certificate no; \
    open -u '$FTP_USER','$FTP_PASS' '$FTP_HOST'; \
    mirror -R --delete --verbose --parallel=4 '$STAGE' '$FTP_DIR'"
else
  echo "lftp not installed. Install it, or upload $STAGE by hand."
  echo "staged copy left at: $STAGE"
  trap - EXIT
  exit 1
fi
echo "done"
