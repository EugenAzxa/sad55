<?php
/* Напоминания дневника трезвости (веб-пуш).

   Телефон подписывается на уведомления и присылает сюда только адрес доставки
   (endpoint), который ему выдал Google, Apple или Mozilla. Что человек бросает
   и сколько дней держится, сервер не знает.

   Раз в день cron запускает рассылку: на каждый адрес уходит пустой пуш,
   подписанный ключом VAPID. Текст с числом дней собирает сам телефон
   (sw.js, событие push) из записей дневника, которые лежат только у него.

   Ключи и секрет: data/push-key.php (не в git). Подписки: data/push/subs.json.

   Рассылка:  php push.php send   или  GET ?a=send&key=СЕКРЕТ  (для cron)
   Проверка:  php push.php check  или  GET ?a=check&key=СЕКРЕТ

   Пишется под PHP 7.2+, как и остальная админка. */

date_default_timezone_set('Europe/Moscow');
define('PUSH_DIR', __DIR__ . '/data/push');
define('SUBS_FILE', PUSH_DIR . '/subs.json');
define('LOG_FILE', PUSH_DIR . '/log.txt');
const MAX_SUBS = 20000;
// пуш-сервисы браузеров; на другие адреса ничего не шлём
const PUSH_HOSTS = '~^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/~';

$cli = PHP_SAPI === 'cli';
if (!$cli) {
  header('X-Robots-Tag: noindex, nofollow');
  header('Cache-Control: no-store');
}

function cfg() {
  static $c = null;
  if ($c === null) {
    $c = is_file(__DIR__ . '/data/push-key.php') ? include __DIR__ . '/data/push-key.php' : array();
  }
  return $c;
}

function out($data, $code = 200) {
  global $cli;
  if ($cli) { echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n"; exit($code < 400 ? 0 : 1); }
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

/* Прочитать подписки под блокировкой и, если $fn вернула массив, записать его.
   Нечитаемый файл не перезаписываем, чтобы не потерять подписки. */
function with_subs($fn) {
  if (!is_dir(PUSH_DIR) && !@mkdir(PUSH_DIR, 0755)) return null;
  $fp = @fopen(SUBS_FILE, 'c+');
  if (!$fp) return null;
  flock($fp, LOCK_EX);
  $raw = (string)stream_get_contents($fp);
  $d = $raw === '' ? array() : json_decode($raw, true);
  if (!is_array($d)) { flock($fp, LOCK_UN); fclose($fp); return null; }
  $new = $fn($d);
  if (is_array($new)) {
    $j = json_encode($new, JSON_UNESCAPED_SLASHES);
    if ($j !== false) { ftruncate($fp, 0); rewind($fp); fwrite($fp, $j); fflush($fp); }
    $d = $new;
  }
  flock($fp, LOCK_UN);
  fclose($fp);
  return $d;
}

function b64u($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }

/* openssl отдаёт подпись ECDSA в DER, а JWT ES256 ждёт r||s по 32 байта */
function der_to_raw($der) {
  $pos = 2;
  if (ord($der[1]) & 0x80) $pos += ord($der[1]) & 0x7f;
  $pos++; $rl = ord($der[$pos]); $pos++; $r = substr($der, $pos, $rl); $pos += $rl;
  $pos++; $sl = ord($der[$pos]); $pos++; $s = substr($der, $pos, $sl);
  $r = str_pad(ltrim($r, "\x00"), 32, "\x00", STR_PAD_LEFT);
  $s = str_pad(ltrim($s, "\x00"), 32, "\x00", STR_PAD_LEFT);
  return $r . $s;
}

function vapid_auth($endpoint) {
  $c = cfg();
  $u = parse_url($endpoint);
  $head = b64u(json_encode(array('typ' => 'JWT', 'alg' => 'ES256')));
  $body = b64u(json_encode(array('aud' => $u['scheme'] . '://' . $u['host'], 'exp' => time() + 12 * 3600,
                                 'sub' => $c['subject']), JSON_UNESCAPED_SLASHES));
  $key = openssl_pkey_get_private($c['private']);
  if (!$key || !openssl_sign($head . '.' . $body, $sig, $key, OPENSSL_ALGO_SHA256)) {
    throw new RuntimeException('Не подписать VAPID: ' . openssl_error_string());
  }
  return 'vapid t=' . $head . '.' . $body . '.' . b64u(der_to_raw($sig)) . ', k=' . $c['public'];
}

function log_line($s) { @file_put_contents(LOG_FILE, date('Y-m-d H:i:s') . ' ' . $s . "\n", FILE_APPEND | LOCK_EX); }

/* Разослать пустой пуш всем подпискам. Пачками по 20, мёртвые (404, 410) удаляем. */
function send_all() {
  $subs = with_subs(function ($d) { return null; });
  if ($subs === null) out(array('error' => 'Не читается data/push/subs.json'), 500);
  $ok = 0; $dead = array(); $fail = 0;
  foreach (array_chunk($subs, 20, true) as $chunk) {
    $mh = curl_multi_init();
    $hs = array();
    foreach ($chunk as $id => $s) {
      $ch = curl_init($s['e']);
      curl_setopt_array($ch, array(
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => '', CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => array('Authorization: ' . vapid_auth($s['e']), 'TTL: 43200', 'Urgency: normal',
                                    'Topic: amc-daily', 'Content-Length: 0'),
      ));
      curl_multi_add_handle($mh, $ch);
      $hs[$id] = $ch;
    }
    do { $st = curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 1.0); } while ($run && $st === CURLM_OK);
    foreach ($hs as $id => $ch) {
      $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
      if ($code >= 200 && $code < 300) $ok++;
      elseif ($code === 404 || $code === 410) $dead[$id] = true;
      else $fail++;
      curl_multi_remove_handle($mh, $ch);
      curl_close($ch);
    }
    curl_multi_close($mh);
  }
  if ($dead) with_subs(function ($d) use ($dead) { return array_diff_key($d, $dead); });
  $res = array('subs' => count($subs), 'sent' => $ok, 'removed' => count($dead), 'failed' => $fail);
  log_line(json_encode($res));
  return $res;
}

function check() {
  $c = cfg();
  $subs = with_subs(function ($d) { return null; });
  return array(
    'php' => PHP_VERSION,
    'curl' => function_exists('curl_multi_init'),
    'openssl' => function_exists('openssl_sign'),
    'keys' => !empty($c['public']) && !empty($c['private']),
    'key_ok' => !empty($c['private']) && (bool)@openssl_pkey_get_private($c['private']),
    'subs' => is_array($subs) ? count($subs) : null,
    'writable' => is_dir(PUSH_DIR) && is_writable(PUSH_DIR),
  );
}

/* ---------- запуск ---------- */

if ($cli) {
  $cmd = $argv[1] ?? '';
  if ($cmd === 'send') out(send_all());
  if ($cmd === 'check') out(check());
  out(array('error' => 'php push.php send | check'), 400);
}

$a = $_GET['a'] ?? '';

if ($a === 'send' || $a === 'check') {
  $c = cfg();
  if (empty($c['secret']) || !hash_equals($c['secret'], (string)($_GET['key'] ?? ''))) { http_response_code(404); exit; }
  out($a === 'send' ? send_all() : check());
}

if (($a === 'sub' || $a === 'unsub') && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
  $in = json_decode((string)file_get_contents('php://input', false, null, 0, 4096), true);
  $e = is_array($in) && is_string($in['endpoint'] ?? null) ? trim($in['endpoint']) : '';
  if ($e === '' || strlen($e) > 800 || !preg_match(PUSH_HOSTS, $e)) out(array('error' => 'Неверный адрес подписки'), 422);
  $id = sha1($e);
  $res = with_subs(function ($d) use ($a, $id, $e) {
    if ($a === 'unsub') { unset($d[$id]); return $d; }
    if (!isset($d[$id]) && count($d) >= MAX_SUBS) return null;
    $d[$id] = array('e' => $e, 't' => date('Y-m-d'));
    return $d;
  });
  if ($res === null) out(array('error' => 'Не сохранилось'), 500);
  out(array('ok' => true));
}

http_response_code(404);
