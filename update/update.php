<?php
require_once '../public/fetch_lib.php';

$live = true;

$basePath = '../public/data';
if (!is_dir($basePath)) mkdir($basePath, 0755, true);

echo "\nData Downloader\n";

$timezone = new DateTimeZone('America/New_York');
$now = new DateTime('now', $timezone);

/* Games */
if ($live) {
    $output = updateGames($now, $basePath);
    if (isset($output['title'])) echo "\n{$output['title']}\n";
    if (isset($output['content'])) echo "{$output['content']}\n";
    if (isset($output['error'])) die("{$output['error']}\n\n");
}

$ch = curl_init();

/* Picks */
if ($live) {
    $output = updatePicks($ch, $basePath);
    if (isset($output['title'])) echo "\n{$output['title']}\n";
    if (isset($output['content'])) echo "{$output['content']}\n";
    if (isset($output['error'])) die("{$output['error']}\n\n");
}

/* DraftKings */
if ($live) {
    $output = updateBet1($ch, $basePath);
    if (isset($output['title'])) echo "\n{$output['title']}\n";
    if (isset($output['content'])) echo "{$output['content']}\n";
    if (isset($output['error'])) die("{$output['error']}\n\n");
}

$endOfDay = new DateTime('tomorrow midnight', $timezone);
$endOfDay = $endOfDay->getTimestamp();

/* FanDuel */
if ($live) {
    $output = updateBet2($endOfDay, $ch, $basePath);
    if (isset($output['title'])) echo "\n{$output['title']}\n";
    if (isset($output['content'])) echo "{$output['content']}\n";
    if (isset($output['error'])) die("{$output['error']}\n\n");
}

/* BetMGM */
if ($live) {
    $output = updateBet3($endOfDay, $ch, $basePath);
    if (isset($output['title'])) echo "\n{$output['title']}\n";
    if (isset($output['content'])) echo "{$output['content']}\n";
    if (isset($output['error'])) die("{$output['error']}\n\n");
}

/* BetRivers */
if ($live) {
    $output = updateBet4($endOfDay, $basePath);
    if (isset($output['title'])) echo "\n{$output['title']}\n";
    if (isset($output['content'])) echo "{$output['content']}\n";
    if (isset($output['error'])) die("{$output['error']}\n\n");
}

/* Backup */
if ($live) {
    $output = backup($now, $timezone, $basePath);
    if (isset($output['title'])) echo "\n{$output['title']}\n";
    if (isset($output['content'])) echo "{$output['content']}\n";
    if (isset($output['error'])) die("{$output['error']}\n\n");
}

echo "\nComplete\n";
echo "\n{$now->format('Y-m-d h:i A')}\n\n";
