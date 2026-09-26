#!/bin/sh
# Собрать архив для заливки на SpaceWeb.
# Всё, что нужно сайту, и ничего из того, что нужно только разработке:
# архив распаковывается прямо в public_html и становится открытым для всех.
set -e
OUT="$HOME/Downloads/sad56-site.zip"
rm -f "$OUT"
zip -rq "$OUT" . \
  -x '.git/*' '.git' \
     '.vercel/*' '.vercel' \
     '.gitignore' '.vercelignore' \
     'brag-output/*' '_probe/*' \
     'README.md' 'deploy-sweb.sh' 'make-zip.sh' '.ftp-credentials' \
     '.DS_Store' '*/.DS_Store'
echo "$OUT"
unzip -l "$OUT" | tail -2
