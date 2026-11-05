<?php
/* Счётчик нажатий для вкладки «Клики» в админке.

   Сайт шлёт сюда (navigator.sendBeacon из assets/js/main.js) только адрес
   и заголовок страницы, текст кнопки или ссылки и куда она ведёт. IP, cookie, браузер и
   прочие сведения о посетителе не сохраняются. Счётчики лежат по месяцам в
   data/clicks/ГГГГ-ММ.json, папка data закрыта для чтения снаружи.

   Пишется под PHP 7.2+, как и остальная админка. */

header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

function done() { http_response_code(204); exit; }

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); exit; }

// роботы и предпросмотр ссылок не считаются
$ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
if ($ua === '' || preg_match('/bot|crawl|spider|slurp|headless|preview|lighthouse/i', $ua)) done();

$in = json_decode((string)file_get_contents('php://input', false, null, 0, 2048), true);
if (!is_array($in)) done();

function clean($v, $max) {
  $s = is_string($v) ? $v : '';
  $s = preg_replace('/[\x00-\x1F\x7F]/u', '', $s);
  $s = trim(preg_replace('/\s+/u', ' ', (string)$s));
  return mb_substr($s, 0, $max, 'UTF-8');
}

$page = clean($in['p'] ?? '', 120);
$title = clean($in['t'] ?? '', 90);
$label = clean($in['l'] ?? '', 80);
$to = clean($in['h'] ?? '', 160);
if ($page === '' || $page[0] !== '/' || ($label === '' && $to === '')) done();

date_default_timezone_set('Europe/Moscow');
$dir = __DIR__ . '/data/clicks';
if (!is_dir($dir) && !@mkdir($dir, 0755)) done();

const MAX_ITEMS = 6000;   // столько разных пар «страница + кнопка» за месяц, дальше новые не заводим

$fp = @fopen($dir . '/' . date('Y-m') . '.json', 'c+');
if (!$fp) done();
flock($fp, LOCK_EX);
$raw = (string)stream_get_contents($fp);
$d = $raw === '' ? array() : json_decode($raw, true);
// файл не читается: не перезаписываем, чтобы не потерять месяц
if (!is_array($d)) { flock($fp, LOCK_UN); fclose($fp); done(); }

$key = $page . "\t" . $label . "\t" . $to;
if (isset($d[$key]) || count($d) < MAX_ITEMS) {
  $it = $d[$key] ?? array('p' => $page, 'l' => $label, 'h' => $to, 'd' => array());
  if ($title !== '') $it['t'] = $title;
  $day = date('Y-m-d');
  $it['d'][$day] = ($it['d'][$day] ?? 0) + 1;
  $d[$key] = $it;
  $out = json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($out !== false) {
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, $out);
    fflush($fp);
  }
}
flock($fp, LOCK_UN);
fclose($fp);
done();
