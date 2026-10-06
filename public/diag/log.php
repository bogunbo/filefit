<?php
/**
 * FileFit diagnostics endpoint
 *  POST  JSON array of events  → appended to data/log-YYYY-MM.jsonl
 *  GET   ?view=summary (default) | raw | json   [&days=30] [&test=1] [&ext=pdf] [&n=500]
 * Events contain metadata only (type, size, result, timings, browser). File names only in test mode.
 */
declare(strict_types=1);
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

$DATA = __DIR__ . '/data';
$MAX_FILE = 50 * 1024 * 1024;        // stop writing a month's log after 50 MB
$MAX_BODY = 256 * 1024;

if (!is_dir($DATA)) {
    @mkdir($DATA, 0755, true);
}
if (!file_exists("$DATA/.htaccess")) {
    @file_put_contents("$DATA/.htaccess", "Require all denied\nDeny from all\n");
}

// ---------------------------------------------------------------- write
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    $raw = file_get_contents('php://input', false, null, 0, $MAX_BODY + 1);
    if ($raw === false || strlen($raw) > $MAX_BODY) { http_response_code(413); echo '{"ok":false}'; exit; }
    $events = json_decode($raw, true);
    if (!is_array($events)) { http_response_code(400); echo '{"ok":false}'; exit; }
    if (isset($events['type'])) $events = [$events];

    $allowed = ['t','v','sid','test','type','name','ext','cat','size','outSize','outExt','saved','status','note',
                'ms','preset','opts','trace','browser','ua','caps','where'];
    $ipHash = substr(hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . date('Y-m') . __FILE__), 0, 10);
    $file = "$DATA/log-" . date('Y-m') . '.jsonl';
    if (file_exists($file) && filesize($file) > $MAX_FILE) { echo '{"ok":false,"full":true}'; exit; }

    $lines = '';
    foreach (array_slice($events, 0, 50) as $e) {
        if (!is_array($e)) continue;
        $clean = ['st' => gmdate('c'), 'ip' => $ipHash];
        foreach ($allowed as $k) {
            if (!array_key_exists($k, $e)) continue;
            $v = $e[$k];
            if (is_string($v)) $v = mb_substr($v, 0, $k === 'ua' ? 250 : 400);
            elseif (is_array($v)) $v = json_decode(mb_substr(json_encode($v, JSON_UNESCAPED_UNICODE), 0, 4000), true) ?? [];
            elseif (!is_int($v) && !is_float($v) && !is_bool($v) && $v !== null) continue;
            $clean[$k] = $v;
        }
        $lines .= json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    }
    if ($lines !== '') file_put_contents($file, $lines, FILE_APPEND | LOCK_EX);
    echo '{"ok":true}';
    exit;
}

// ---------------------------------------------------------------- read
$days  = max(1, min(365, (int)($_GET['days'] ?? 30)));
$onlyTest = isset($_GET['test']) && $_GET['test'] !== '0';
$extFilter = isset($_GET['ext']) ? strtolower(preg_replace('/[^a-z0-9]/i', '', $_GET['ext'])) : '';
$since = time() - $days * 86400;

$events = [];
$files = glob("$DATA/log-*.jsonl") ?: [];
sort($files);
foreach (array_slice($files, -13) as $f) {
    $h = fopen($f, 'r');
    if (!$h) continue;
    while (($line = fgets($h)) !== false) {
        $e = json_decode($line, true);
        if (!$e) continue;
        if (strtotime($e['st'] ?? '1970-01-01') < $since) continue;
        if ($onlyTest && empty($e['test'])) continue;
        if ($extFilter && ($e['ext'] ?? '') !== $extFilter && ($e['type'] ?? '') === 'file') continue;
        $events[] = $e;
    }
    fclose($h);
}

$view = $_GET['view'] ?? 'summary';

if ($view === 'raw') {
    header('Content-Type: text/plain; charset=utf-8');
    $n = max(1, min(20000, (int)($_GET['n'] ?? 500)));
    foreach (array_slice($events, -$n) as $e) echo json_encode($e, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
    exit;
}

// aggregate
$byExt = []; $browsers = []; $problems = []; $jsErrors = []; $sessions = [];
foreach ($events as $e) {
    $type = $e['type'] ?? '';
    if ($type === 'session') { $sessions[$e['sid'] ?? ''] = $e; continue; }
    if ($type === 'jserror') { $jsErrors[] = $e; continue; }
    if ($type !== 'file') continue;
    $ext = $e['ext'] ?: '(none)';
    $s = $e['status'] ?? '?';
    if (!isset($byExt[$ext])) $byExt[$ext] = ['n'=>0,'done'=>0,'skipped'=>0,'error'=>0,'saved'=>0,'ms'=>0,'notes'=>[],'cat'=>$e['cat'] ?? ''];
    $b = &$byExt[$ext];
    $b['n']++; $b[$s] = ($b[$s] ?? 0) + 1;
    if ($s === 'done') { $b['saved'] += (float)($e['saved'] ?? 0); $b['ms'] += (int)($e['ms'] ?? 0); }
    if ($s !== 'done' && !empty($e['note'])) {
        $k = preg_replace('/(?<![\w-])\d[\d.,]*/', '#', $e['note']);
        $b['notes'][$k] = ($b['notes'][$k] ?? 0) + 1;
    }
    unset($b);
    $br = $e['browser'] ?? '?';
    $browsers[$br][$s] = ($browsers[$br][$s] ?? 0) + 1;
    if ($s === 'error' || $s === 'skipped') $problems[] = $e;
}
ksort($byExt);

if ($view === 'json') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['days'=>$days,'files'=>array_sum(array_column($byExt,'n')),'byExt'=>(object)$byExt,'browsers'=>(object)$browsers,
        'problems'=>array_slice(array_reverse($problems),0,300),'jsErrors'=>array_slice(array_reverse($jsErrors),0,100),
        'sessions'=>array_values($sessions)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

// ---------------------------------------------------------------- HTML summary
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function kb($b) { $b = (float)$b; if ($b < 1024) return round($b).' B'; if ($b < 1048576) return round($b/1024,1).' KB'; return round($b/1048576,2).' MB'; }
$total = array_sum(array_column($byExt, 'n'));
$done = array_sum(array_column($byExt, 'done'));
$err = array_sum(array_column($byExt, 'error'));
$skp = array_sum(array_column($byExt, 'skipped'));
$q = function($extra) use ($days, $onlyTest) { return '?' . http_build_query(array_merge(['days'=>$days] + ($onlyTest ? ['test'=>1] : []), $extra)); };
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FileFit diagnostics</title>
<style>
:root{--bg:#0b0f17;--card:#131926;--b:#1f293d;--t:#e2e8f0;--m:#94a3b8;--ok:#34d399;--warn:#fcd34d;--bad:#fb7185;--acc:#818cf8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:14px/1.45 Inter,system-ui,sans-serif;padding:24px 16px}
.wrap{max-width:1200px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px}
.muted{color:var(--m)}a{color:var(--acc)}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
.tile{background:var(--card);border:1px solid var(--b);border-radius:12px;padding:12px}.tile b{display:block;font-size:22px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--b);border-radius:12px;overflow:hidden;font-size:13px}
th,td{padding:7px 10px;border-bottom:1px solid var(--b);text-align:left;vertical-align:top}th{color:var(--m);font-weight:600;font-size:12px}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.num{text-align:right;white-space:nowrap}
.bar{display:flex;height:6px;border-radius:3px;overflow:hidden;min-width:80px;background:var(--b)}.bar i{display:block}
.trace{color:#64748b;font-size:11px;font-family:ui-monospace,monospace}.filters a{margin-right:10px}
.scroll{overflow-x:auto}
</style></head><body><div class="wrap">
<h1>FileFit diagnostics</h1>
<p class="muted">Last <?=h($days)?> days<?= $onlyTest ? ' · test mode only' : '' ?><?= $extFilter ? ' · .'.h($extFilter) : '' ?> · <?=count($sessions)?> sessions</p>
<p class="filters muted">Range: <a href="<?=h($q(['days'=>1]))?>">24h</a><a href="<?=h($q(['days'=>7]))?>">7 days</a><a href="<?=h($q(['days'=>30]))?>">30 days</a>
 · <a href="?days=<?=h($days)?>&test=1">test mode only</a><a href="?days=<?=h($days)?>">everything</a>
 · <a href="<?=h($q(['view'=>'raw','n'=>1000]))?>">raw log</a><a href="<?=h($q(['view'=>'json']))?>">JSON</a></p>

<div class="tiles">
 <div class="tile"><span class="muted">Files</span><b><?=$total?></b></div>
 <div class="tile"><span class="muted">Optimized</span><b class="ok"><?=$done?></b></div>
 <div class="tile"><span class="muted">Kept original</span><b class="warn"><?=$skp?></b></div>
 <div class="tile"><span class="muted">Failed</span><b class="bad"><?=$err?></b></div>
 <div class="tile"><span class="muted">JS errors</span><b class="<?=count($jsErrors)?'bad':''?>"><?=count($jsErrors)?></b></div>
</div>

<h2>By file type</h2>
<div class="scroll"><table><tr><th>Type</th><th class="num">Files</th><th>Result</th><th class="num">Done</th><th class="num">Kept</th><th class="num">Failed</th><th class="num">Avg saved</th><th class="num">Avg time</th><th>Most common reasons (not optimized)</th></tr>
<?php foreach ($byExt as $ext => $b): arsort($b['notes']); $n = max(1,$b['n']); ?>
<tr><td><a href="<?=h($q(['ext'=>$ext]))?>"><b>.<?=h($ext)?></b></a> <span class="muted"><?=h($b['cat'])?></span></td>
<td class="num"><?=$b['n']?></td>
<td><div class="bar"><i style="width:<?=100*$b['done']/$n?>%;background:var(--ok)"></i><i style="width:<?=100*$b['skipped']/$n?>%;background:var(--warn)"></i><i style="width:<?=100*$b['error']/$n?>%;background:var(--bad)"></i></div></td>
<td class="num ok"><?=$b['done']?></td><td class="num warn"><?=$b['skipped']?></td><td class="num bad"><?=$b['error']?></td>
<td class="num"><?= $b['done'] ? round($b['saved']/$b['done'],1).'%' : '–' ?></td>
<td class="num"><?= $b['done'] ? round($b['ms']/$b['done']/1000,1).'s' : '–' ?></td>
<td class="muted"><?php foreach (array_slice($b['notes'],0,3,true) as $note=>$c) echo h($note)." <b>×$c</b><br>"; ?></td></tr>
<?php endforeach; if (!$byExt) echo '<tr><td colspan="9" class="muted">No data yet.</td></tr>'; ?>
</table></div>

<h2>By browser</h2>
<div class="scroll"><table><tr><th>Browser</th><th class="num">Done</th><th class="num">Kept</th><th class="num">Failed</th></tr>
<?php foreach ($browsers as $br => $c): ?><tr><td><?=h($br)?></td><td class="num ok"><?=$c['done']??0?></td><td class="num warn"><?=$c['skipped']??0?></td><td class="num bad"><?=$c['error']??0?></td></tr><?php endforeach; ?>
</table></div>

<h2>Recent problems (newest first)</h2>
<div class="scroll"><table><tr><th>When</th><th>File</th><th>Status</th><th>Reason &amp; trace</th><th>Browser</th></tr>
<?php foreach (array_slice(array_reverse($problems), 0, 150) as $e): ?>
<tr><td class="muted" style="white-space:nowrap"><?=h(substr($e['st'] ?? '',0,16))?></td>
<td><b>.<?=h($e['ext'] ?? '')?></b> <?=h(kb($e['size'] ?? 0))?><?= !empty($e['name']) ? '<br><span class="muted">'.h($e['name']).'</span>' : '' ?></td>
<td class="<?= ($e['status'] ?? '') === 'error' ? 'bad' : 'warn' ?>"><?=h($e['status'] ?? '')?></td>
<td><?=h($e['note'] ?? '')?><?php if (!empty($e['trace'])): ?><div class="trace"><?=h(implode(' › ', (array)$e['trace']))?></div><?php endif; ?></td>
<td class="muted"><?=h($e['browser'] ?? '')?> <span class="trace"><?=h($e['preset'] ?? '')?> <?=h($e['opts'] ?? '')?></span></td></tr>
<?php endforeach; if (!$problems) echo '<tr><td colspan="5" class="muted">No problems logged.</td></tr>'; ?>
</table></div>

<?php if ($jsErrors): ?>
<h2>JavaScript errors</h2>
<div class="scroll"><table><tr><th>When</th><th>Error</th><th>Where</th><th>Version</th></tr>
<?php foreach (array_slice(array_reverse($jsErrors), 0, 50) as $e): ?>
<tr><td class="muted"><?=h(substr($e['st'] ?? '',0,16))?></td><td class="bad"><?=h($e['note'] ?? '')?></td><td class="trace"><?=h($e['where'] ?? '')?></td><td class="muted"><?=h($e['v'] ?? '')?></td></tr>
<?php endforeach; ?></table></div>
<?php endif; ?>
</div></body></html>
