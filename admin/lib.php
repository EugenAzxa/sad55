<?php
/* Админка цен и акций: данные, проверка, отрисовка блоков сайта.

   Сайт статический, поэтому цены живут прямо в HTML. Источник правды -
   data/prices.json. При каждом сохранении из него заново рисуются блоки
   между метками <!-- admin:ИМЯ --> и <!-- /admin:ИМЯ --> на страницах
   из PAGES, всё остальное в файлах не трогается.

   deploy.py перед заливкой забирает с сервера prices.json и эти же блоки,
   чтобы заливка с Mac не затёрла то, что поменяли в админке.

   Пишется под PHP 7.2+: какая версия стоит у хостинга, заранее не знаем. */

if (!defined('ADMIN')) { http_response_code(404); exit; }

mb_internal_encoding('UTF-8');
date_default_timezone_set('Europe/Moscow');

define('SITE_ROOT', dirname(__DIR__));
define('DATA_DIR', __DIR__ . '/data');
define('DATA_FILE', DATA_DIR . '/prices.json');
define('BACKUP_DIR', DATA_DIR . '/backups');
define('BACKUPS_KEEP', 30);

// какие блоки на какой странице
const PAGES = array(
  'price-and-services.html' => array('promo', 'prices'),
  'index.html' => array('promo', 'home-cards'),
  'smoke.html' => array('smoke-price'),
);

function e($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

function today() { return date('Y-m-d'); }

/* ---------- данные ---------- */

function load_data() {
  $raw = @file_get_contents(DATA_FILE);
  $d = $raw === false ? null : json_decode($raw, true);
  if (!is_array($d)) throw new RuntimeException('Не читается data/prices.json');
  return $d;
}

function write_atomic($file, $text) {
  $tmp = $file . '.tmp' . bin2hex(random_bytes(4));
  if (file_put_contents($tmp, $text) === false) throw new RuntimeException('Не записать ' . basename($file));
  if (!rename($tmp, $file)) { @unlink($tmp); throw new RuntimeException('Не записать ' . basename($file)); }
}

function clean_str($v, $max) {
  $s = is_scalar($v) ? (string)$v : '';
  $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s);
  $s = preg_replace('/\s+/u', ' ', str_replace("\xC2\xA0", ' ', $s));
  $s = trim(str_replace(array('—', '–'), '-', $s));
  if (mb_strlen($s) > $max) $s = mb_substr($s, 0, $max);
  return $s;
}

/* «10000», «от 11900», «10 000 руб.» - всё приводим к «10 000» / «от 11 900».
   Если там не число («бесплатно», «по запросу»), оставляем как написали. */
function norm_price($v) {
  $s = clean_str($v, 40);
  $s = preg_replace('/\s*(руб\.?|р\.|₽)\s*$/iu', '', $s);
  if (preg_match('/^(от\s*)?(\d[\d\s]*)$/iu', $s, $m)) {
    $n = preg_replace('/\D/', '', $m[2]);
    return ($m[1] !== '' ? 'от ' : '') . number_format((float)$n, 0, '', ' ');
  }
  return $s;
}

function is_date($s) { return is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $s); }

/* Всё, что прислал браузер, пересобираем заново: только известные поля,
   ограниченной длины. Ошибку возвращаем человеческим языком. */
function validate($in) {
  if (!is_array($in)) throw new InvalidArgumentException('Пустые данные');
  $out = array('promos' => array(), 'groups' => array(), 'home' => array(), 'smoke' => array());

  foreach (array_slice((array)($in['promos'] ?? array()), 0, 12) as $p) {
    $t = clean_str($p['title'] ?? '', 120);
    if ($t === '') throw new InvalidArgumentException('У акции нет заголовка');
    $u = $p['until'] ?? '';
    $out['promos'][] = array(
      'on' => !empty($p['on']),
      'title' => $t,
      'text' => clean_str($p['text'] ?? '', 400),
      'until' => is_date($u) ? $u : '',
    );
  }

  foreach (array_slice((array)($in['groups'] ?? array()), 0, 40) as $g) {
    $t = clean_str($g['title'] ?? '', 150);
    if ($t === '') throw new InvalidArgumentException('У раздела прайса нет названия');
    $rows = array();
    foreach (array_slice((array)($g['rows'] ?? array()), 0, 120) as $r) {
      $name = clean_str($r['name'] ?? '', 200);
      $price = norm_price($r['price'] ?? '');
      if ($name === '' && $price === '') continue;
      if ($name === '') throw new InvalidArgumentException('В разделе «' . $t . '» есть цена без названия услуги');
      if ($price === '') throw new InvalidArgumentException('Не указана цена: «' . $name . '»');
      $rows[] = array('name' => $name, 'time' => clean_str($r['time'] ?? '', 30), 'price' => $price);
    }
    $out['groups'][] = array('title' => $t, 'note' => clean_str($g['note'] ?? '', 300), 'time' => !empty($g['time']), 'rows' => $rows);
  }
  if (!$out['groups']) throw new InvalidArgumentException('В прайсе не осталось ни одного раздела');

  $home = array_values((array)($in['home'] ?? array()));
  for ($i = 0; $i < 3; $i++) {
    $c = $home[$i] ?? array();
    $name = clean_str($c['name'] ?? '', 120);
    $price = norm_price($c['price'] ?? '');
    if ($name === '' || $price === '') throw new InvalidArgumentException('Заполните карточку ' . ($i + 1) . ' на главной: название и цену');
    $out['home'][] = array('name' => $name, 'price' => $price, 'desc' => clean_str($c['desc'] ?? '', 200));
  }

  $sp = norm_price($in['smoke']['price'] ?? '');
  if ($sp === '') throw new InvalidArgumentException('Не указана цена курса против курения');
  $out['smoke']['price'] = $sp;

  return $out;
}

/* ---------- отрисовка ---------- */

function price_text($p) {
  return preg_match('/^(от )?\d[\d ]*$/u', $p) ? e($p) . ' руб.' : e($p);
}

// для крупных цифр в карточках: «от» и «руб.» мелким
function price_big($p) {
  if (!preg_match('/^(от )?(\d[\d ]*)$/u', $p, $m)) return e($p);
  return ($m[1] !== '' ? '<small>от</small> ' : '') . e($m[2]) . ' <small>руб.</small>';
}

function until_text($d) {
  $months = array('января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря');
  list($y, $m, $day) = array_map('intval', explode('-', $d));
  return 'до ' . $day . ' ' . $months[$m - 1] . ' ' . $y;
}

const ICON_TAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>';

function render_promo($d) {
  $today = today();
  $items = '';
  foreach ($d['promos'] as $p) {
    if (empty($p['on']) || ($p['until'] !== '' && $p['until'] < $today)) continue;
    $items .= "\n      <article class=\"promo\"" . ($p['until'] !== '' ? ' data-until="' . e($p['until']) . '"' : '') . ">\n"
      . '        <span class="promo-tag">' . ICON_TAG . "Акция</span>\n"
      . '        <h3 class="promo-title">' . e($p['title']) . "</h3>\n"
      . ($p['text'] !== '' ? '        <p class="promo-text">' . e($p['text']) . "</p>\n" : '')
      . '        <div class="promo-foot">'
      . ($p['until'] !== '' ? '<span class="promo-until">' . until_text($p['until']) . '</span>' : '')
      . '<button type="button" class="promo-call" data-open-modal>Узнать подробнее</button>'
      . "</div>\n      </article>";
  }
  if ($items === '') return '';
  return "\n    <div class=\"promos reveal\" aria-label=\"Акции\">" . $items . "\n    </div>\n    ";
}

function render_prices($d) {
  $h = '';
  foreach ($d['groups'] as $g) {
    $h .= "\n    <div class=\"pgroup reveal\">\n      <h3>" . e($g['title']) . "</h3>\n";
    if ($g['note'] !== '') $h .= '      <p class="pgroup-note">' . e($g['note']) . "</p>\n";
    $h .= "      <div class=\"ptable-wrap\">\n        <table class=\"ptable\">\n          <thead><tr><th>Услуга</th>"
      . ($g['time'] ? '<th>Время</th>' : '') . "<th style=\"text-align:right\">Стоимость</th></tr></thead>\n          <tbody>\n";
    $rows = $g['rows'];
    $n = count($rows);
    for ($i = 0; $i < $n; $i++) {
      $r = $rows[$i];
      $cells = '';
      if ($g['time']) {
        // одна услуга с разной ценой по времени суток - одна ячейка с названием на все строки
        if ($i === 0 || $rows[$i - 1]['name'] !== $r['name']) {
          $span = 1;
          while ($i + $span < $n && $rows[$i + $span]['name'] === $r['name']) $span++;
          $cells .= '<td' . ($span > 1 ? ' rowspan="' . $span . '"' : '') . '>' . e($r['name']) . '</td>';
        }
        $cells .= '<td>' . ($r['time'] !== '' ? e($r['time']) : '-') . '</td>';
      } else {
        $cells .= '<td>' . e($r['name']) . '</td>';
      }
      $h .= '            <tr>' . $cells . '<td>' . price_text($r['price']) . "</td></tr>\n";
    }
    $h .= "          </tbody>\n        </table>\n      </div>\n    </div>\n";
  }
  return $h . "\n    ";
}

function render_home_cards($d) {
  // значки и оформление закреплены за местом карточки
  $look = array(
    array('', '<path d="M12 2v6"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/><circle cx="12" cy="10" r="2"/>'),
    array(' featured', '<path d="M12 21c-4.97-2.61-8-6.19-8-10V5l8-3 8 3v6c0 3.81-3.03 7.39-8 10Z"/><path d="M9.5 11.5 11 13l3.5-3.5"/>'),
    array('', '<path d="m3 11 9-8 9 8"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>'),
  );
  $delay = array('', ' d1', ' d2');
  $h = '';
  foreach ($d['home'] as $i => $c) {
    $h .= "\n      <article class=\"price-card" . $look[$i][0] . ' reveal' . $delay[$i] . "\">\n"
      . '        <span class="price-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' . $look[$i][1] . "</svg></span>\n"
      . '        <div class="price-name">' . e($c['name']) . "</div>\n"
      . '        <div class="price-value">' . price_big($c['price']) . "</div>\n"
      . ($c['desc'] !== '' ? '        <p class="price-desc">' . e($c['desc']) . "</p>\n" : '')
      . '      </article>';
  }
  return $h . "\n    ";
}

function render_block($name, $d) {
  switch ($name) {
    case 'promo': return render_promo($d);
    case 'prices': return render_prices($d);
    case 'home-cards': return render_home_cards($d);
    case 'smoke-price': return price_big($d['smoke']['price']);
  }
  throw new RuntimeException('Неизвестный блок ' . $name);
}

/* Вставить свежие блоки в страницу. Сначала собираем все страницы в памяти
   и только если на каждой нашлись все метки, пишем на диск: иначе сайт
   остался бы наполовину со старыми ценами. */
function build_pages($d) {
  $out = array();
  foreach (PAGES as $page => $blocks) {
    $file = SITE_ROOT . '/' . $page;
    $html = @file_get_contents($file);
    if ($html === false) throw new RuntimeException('Не читается ' . $page);
    foreach ($blocks as $b) {
      $re = '#(<!-- admin:' . preg_quote($b, '#') . ' -->).*?(<!-- /admin:' . preg_quote($b, '#') . ' -->)#s';
      $body = render_block($b, $d);
      $html = preg_replace_callback($re, function ($m) use ($body) { return $m[1] . $body . $m[2]; }, $html, 1, $cnt);
      if ($cnt !== 1) throw new RuntimeException('На странице ' . $page . ' нет метки admin:' . $b);
    }
    $out[$file] = $html;
  }
  return $out;
}

/* Цены в статьях, услугах и карточках услуг. blog.py ставит их между метками
   <!--p:Группа|Услуга|Время-->...<!--/p--> и <!--pt:Группа-->...<!--/pt-->,
   здесь они переписываются из свежего прайса. Строку, которой в прайсе больше
   нет (переименовали или удалили), не трогаем: там остаётся старая цена. */

function find_group($d, $title) {
  foreach ($d['groups'] as $g) if ($g['title'] === $title) return $g;
  return null;
}

function ref_price($d, $ref) {
  $p = array_map('trim', explode('|', $ref));
  if (count($p) < 2 || !($g = find_group($d, $p[0]))) return null;
  foreach ($g['rows'] as $r) {
    if ($r['name'] === $p[1] && (count($p) < 3 || $r['time'] === $p[2])) return price_text($r['price']);
  }
  return null;
}

// та же таблица, что price_table_html в blog.py, в одну строку
function ref_table($g) {
  $timed = !empty($g['time']);
  $h = '<div class="ptable-wrap"><table class="ptable"><thead><tr><th>Услуга</th>' . ($timed ? '<th>Время</th>' : '')
    . '<th style="text-align:right">Стоимость</th></tr></thead><tbody>';
  $rows = $g['rows'];
  $n = count($rows);
  for ($i = 0; $i < $n; $i++) {
    $r = $rows[$i];
    $h .= '<tr>';
    if (!$timed) {
      $h .= '<td>' . e($r['name']) . '</td>';
    } elseif ($i === 0 || $rows[$i - 1]['name'] !== $r['name']) {
      $span = 1;
      while ($i + $span < $n && $rows[$i + $span]['name'] === $r['name']) $span++;
      $h .= '<td' . ($span > 1 ? ' rowspan="' . $span . '"' : '') . '>' . e($r['name']) . '</td>';
    }
    if ($timed) $h .= '<td style="white-space:nowrap">' . ($r['time'] !== '' ? e($r['time']) : '-') . '</td>';
    $h .= '<td>' . price_text($r['price']) . '</td></tr>';
  }
  return $h . '</tbody></table></div>';
}

function build_refs($d, $skip) {
  $files = array_merge(glob(SITE_ROOT . '/*.html') ?: array(), glob(SITE_ROOT . '/blog/*.html') ?: array(),
                       glob(SITE_ROOT . '/uslugi/*.html') ?: array());
  $out = array();
  foreach ($files as $file) {
    $html = isset($skip[$file]) ? $skip[$file] : @file_get_contents($file);
    if ($html === false || strpos($html, '<!--p') === false) continue;
    $new = preg_replace_callback('#<!--p:(.*?)-->(.*?)<!--/p-->#s', function ($m) use ($d) {
      $v = ref_price($d, html_entity_decode($m[1], ENT_QUOTES, 'UTF-8'));
      return '<!--p:' . $m[1] . '-->' . ($v === null ? $m[2] : $v) . '<!--/p-->';
    }, $html);
    $new = preg_replace_callback('#<!--pt:(.*?)-->(.*?)<!--/pt-->#s', function ($m) use ($d) {
      $g = find_group($d, html_entity_decode($m[1], ENT_QUOTES, 'UTF-8'));
      return '<!--pt:' . $m[1] . '-->' . ($g ? ref_table($g) : $m[2]) . '<!--/pt-->';
    }, $new);
    if ($new !== null && ($new !== $html || isset($skip[$file]))) $out[$file] = $new;
  }
  return $out;
}

/* ---------- сохранение и история ---------- */

function save_all($clean) {
  $lock = fopen(DATA_DIR . '/.lock', 'c');
  if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Не удалось заблокировать данные');
  try {
    $clean = array('updated' => date('c')) + $clean;
    $pages = build_pages($clean);
    $pages = build_refs($clean, $pages) + $pages;

    if (!is_dir(BACKUP_DIR)) @mkdir(BACKUP_DIR, 0755);
    if (is_file(DATA_FILE)) @copy(DATA_FILE, BACKUP_DIR . '/prices-' . date('Ymd-His') . '.json');
    $old = glob(BACKUP_DIR . '/prices-*.json') ?: array();
    sort($old);
    foreach (array_slice($old, 0, max(0, count($old) - BACKUPS_KEEP)) as $f) @unlink($f);

    write_atomic(DATA_FILE, json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
    foreach ($pages as $file => $html) write_atomic($file, $html);
    return $clean;
  } finally {
    flock($lock, LOCK_UN);
    fclose($lock);
  }
}

function list_backups() {
  $files = glob(BACKUP_DIR . '/prices-*.json') ?: array();
  rsort($files);
  $out = array();
  foreach ($files as $f) {
    if (!preg_match('/prices-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)\d\d\.json$/', $f, $m)) continue;
    $out[] = array('id' => basename($f), 'label' => $m[3] . '.' . $m[2] . '.' . $m[1] . ' ' . $m[4] . ':' . $m[5]);
  }
  return $out;
}

function read_backup($id) {
  if (!preg_match('/^prices-\d{8}-\d{6}\.json$/', (string)$id)) throw new InvalidArgumentException('Нет такой версии');
  $d = json_decode((string)@file_get_contents(BACKUP_DIR . '/' . $id), true);
  if (!is_array($d)) throw new InvalidArgumentException('Нет такой версии');
  return $d;
}

/* ---------- клики (пишет track.php) ---------- */

define('CLICKS_DIR', DATA_DIR . '/clicks');

/* Сводка за последние $days дней: самые нажимаемые кнопки и ссылки,
   звонки и страницы, где нажимают больше всего. */
function clicks_report($days) {
  $days = in_array((int)$days, array(7, 30, 90), true) ? (int)$days : 30;
  $from = date('Y-m-d', strtotime('-' . ($days - 1) . ' days'));
  $months = array();
  for ($t = strtotime($from); date('Y-m', $t) <= date('Y-m'); $t = strtotime('first day of next month', $t)) {
    $months[date('Y-m', $t)] = true;
  }
  $items = array();
  $pages = array();
  $titles = array();
  $first = null;
  $total = 0; $tel = 0; $modal = 0;
  $app = array('install' => 0, 'launch' => 0, 'push' => 0);
  foreach (array_keys($months) as $m) {
    $d = json_decode((string)@file_get_contents(CLICKS_DIR . '/' . $m . '.json'), true);
    if (!is_array($d)) continue;
    foreach ($d as $it) {
      $n = 0;
      foreach ((array)($it['d'] ?? array()) as $day => $c) {
        if ($first === null || $day < $first) $first = $day;
        if ($day >= $from) $n += (int)$c;
      }
      if (!$n) continue;
      $l = (string)($it['l'] ?? ''); $h = (string)($it['h'] ?? ''); $p = (string)($it['p'] ?? '');
      $key = $l . "\t" . $h;
      if (!isset($items[$key])) $items[$key] = array('l' => $l, 'h' => $h, 'n' => 0, 'p' => array());
      $items[$key]['n'] += $n;
      $items[$key]['p'][$p] = ($items[$key]['p'][$p] ?? 0) + $n;
      $pages[$p] = ($pages[$p] ?? 0) + $n;
      if (!empty($it['t'])) $titles[$p] = (string)$it['t'];
      $total += $n;
      if (stripos($h, 'tel:') === 0) $tel += $n;
      if (mb_strpos($h, 'окно') === 0) $modal += $n;
      if ($h === 'дневник:установка') $app['install'] += $n;
      if ($h === 'дневник:запуск') $app['launch'] += $n;
      if ($h === 'дневник:напоминания') $app['push'] += $n;
    }
  }
  foreach ($items as &$it) {
    arsort($it['p']);
    $it['pages'] = count($it['p']);
    $it['p'] = array_slice($it['p'], 0, 3, true);
  }
  unset($it);
  usort($items, function ($a, $b) { return $b['n'] - $a['n']; });
  arsort($pages);
  return array(
    'days' => $days, 'from' => $from, 'since' => $first,
    'total' => $total, 'tel' => $tel, 'modal' => $modal,
    'items' => array_slice($items, 0, 100),
    'pages' => array_slice($pages, 0, 10, true),
    'titles' => $titles,
    'app' => $app,
    'subs' => push_subs_count(),
  );
}

/* сколько телефонов сейчас подписано на напоминания дневника (пишет push.php) */
function push_subs_count() {
  $d = json_decode((string)@file_get_contents(DATA_DIR . '/push/subs.json'), true);
  return is_array($d) ? count($d) : 0;
}
