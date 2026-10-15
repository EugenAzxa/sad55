#!/bin/bash
# Автопубликация блога. launchd запускает его раз в час
# (~/Library/LaunchAgents/ru.sad56.autopublish.plist).
#
# Статья в blog-src со status: approved и датой published в будущем ждёт в drafts/.
# Когда дата наступает, скрипт пересобирает блог, коммитит и заливает на сервер.
# Если сервер не пускает (SSH в панели SpaceWeb гаснет через 24 часа), Mac
# покажет уведомление, а скрипт попробует снова через час.
#
#   ./autopublish.sh         один прогон вручную
#   tail .logs/autopublish.log

cd "$(dirname "$0")" || exit 1
mkdir -p .logs
LOG=.logs/autopublish.log
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"sad56.spb.ru: блог\"" 2>/dev/null; }
dirty() { git status --porcelain | grep -v '^?? notes/tmp/'; }

# Идёт ручная работа: не вмешиваться, иначе на сайт уедут недоделанные правки.
if [ -n "$(dirty)" ]; then
    log "в папке незакоммиченные правки, пропускаю"
    exit 0
fi

out=$(/usr/bin/python3 blog.py 2>&1) || { log "blog.py упал: $out"; notify "Сборка блога упала, см. .logs/autopublish.log"; exit 1; }
if [ -n "$(dirty)" ]; then
    git add -A blog blog.html drafts sitemap.xml llms.txt notes/redirects-sad56ru.htaccess
    git commit -qm "Blog: autopublish $(date +%F)" && log "собрано и закоммичено: $(echo "$out" | tail -1)"
fi

# Заливать есть что: новая статья или закоммиченное, но не залитое раньше.
if /usr/bin/python3 deploy.py --dry 2>&1 | grep -q 'Изменений нет'; then
    exit 0
fi
if res=$(/usr/bin/python3 deploy.py 2>&1); then
    log "залито: $(echo "$res" | grep -c '^   \[') файлов"
    notify "Новая статья на сайте"
else
    log "не залилось: $(echo "$res" | tail -1)"
    hour=$(date +%H)
    if [ "$hour" -ge 9 ] && [ "$hour" -le 21 ]; then
        notify "Статья ждёт заливки: включи SSH в панели SpaceWeb (Инструменты, SSH)"
    fi
fi
