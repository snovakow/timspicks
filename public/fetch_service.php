<?php
require_once './fetch_lib.php';

/* Echo a step's result, stopping the run on error, and return its warnings */
function printOutput(array $output)
{
	if (isset($output['title'])) echo '<h3>' . $output['title'] . '</h3>';
	$warnings = $output['warning'] ?? [];
	foreach ($warnings as $warning) echo '<p class="warning">Warning: ' . htmlspecialchars($warning, ENT_QUOTES, 'UTF-8') . '</p>';
	if (isset($output['content'])) echo $output['content'];
	if (isset($output['error'])) die($output['error']);
	return $warnings;
}

$live = true;
$secure = true;
$savesrc = false;

if ($live && $secure) {
	session_start();

	if (!isset($_SESSION['csrf_token'])) die("Access denied.");

	$csrf_token = $_SESSION['csrf_token'];
	// unset($_SESSION['csrf_token']);

	if ($_SERVER['REQUEST_METHOD'] !== 'POST') die("Invalid request method.");

	$json_data = file_get_contents('php://input');

	$data = json_decode($json_data, true);
	if (!is_array($data) || !isset($data['csrf_token'])) die("Invalid request format.");

	if (!hash_equals($csrf_token, $data['csrf_token'])) die("Session expired.");
	if (!isset($data['code']) || !isset($data['name'])) die("Missing required parameters.");

	$auth_file = './auth.json';
	$auth_data = file_get_contents($auth_file);
	if ($auth_data === false) die('Authentication error.');

	$auth_json = json_decode($auth_data, false);
	if (json_last_error() !== JSON_ERROR_NONE) {
		die('Authentication error: ' . json_last_error_msg());
	}

	if (!property_exists($auth_json, 'name') || !$auth_json->name) die("Authentication error.");
	if (!property_exists($auth_json, 'code') || !$auth_json->code) die("Authentication error.");

	if (!hash_equals($data['name'], $auth_json->name)) die("Incorrect username or password.");
	if (password_verify($data['code'], $auth_json->code)) {
		if (password_needs_rehash($auth_json->code, PASSWORD_DEFAULT)) {
			$auth_json->code = password_hash($data['code'], PASSWORD_DEFAULT);
			$auth_string = json_encode($auth_json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
			if (file_put_contents($auth_file, $auth_string) === false) {
				die('Authentication error.');
			}
		}
	} else {
		die("Incorrect username or password.");
	}
}

if ($live && !isset($_GET['update'])) die("<h2>Invalid Request</h2>");

$basePath = './data';
if (!is_dir($basePath)) mkdir($basePath, 0755, true);

echo '<h1>Data Downloader</h1>';

$timezone = new DateTimeZone('America/New_York');
$now = new DateTime('now', $timezone);

$warnings = [];
if ($live) startRun($now, $basePath);

/* Games */
if ($live) {
	$output = updateGames($now, $basePath);
	$warnings = array_merge($warnings, printOutput($output));
}

/* Scores: today's whether or not a game is in play, unless today has no games, yesterday's while one of its games
   still is, and every earlier day with a snapshot whose scores aren't final, then the archive's index. A failure
   is shown here and stops nothing, and it stays out of the run's warnings, as the cron's scores step is no part
   of a run */
if ($live) {
	$output = updateScores($now, $basePath, true);
	echo '<h3>' . $output['title'] . '</h3>';
	if (isset($output['error'])) echo '<p class="warning">Warning: ' . htmlspecialchars($output['error'], ENT_QUOTES, 'UTF-8') . '</p>';
	if (isset($output['content'])) echo $output['content'];
}

/* A day without games has no draw, and the pick-list feed answers it with an error rather than a list, so the
   schedule and the scores are the whole run, as they are on the cron */
$noGames = $live && scheduledGames($now, $basePath) === 0;
if ($noGames) {
	echo '<h3>No games today</h3>No pick lists or odds to fetch';
	processed($now, $basePath, $warnings);
}

$ch = curl_init();

/* Picks */
if ($live && !$noGames) {
	$output = updatePicks($ch, $basePath, './players', $savesrc);
	$warnings = array_merge($warnings, printOutput($output));
}

/* Sportsbooks, each through the source its mode in the book list names */
if ($live && !$noGames) {
	$endOfDay = new DateTime('tomorrow midnight', $timezone);
	foreach (updateBooks($now, $endOfDay, $ch, $basePath, $savesrc) as $output) {
		$warnings = array_merge($warnings, printOutput($output));
	}
}

/* Backup */
if ($live && !$noGames) {
	$output = backup($now, $timezone, $basePath, $warnings);
	$warnings = array_merge($warnings, printOutput($output));
}

$warningCount = count($warnings);
if ($warningCount) echo '<h2 class="warning">Complete with ' . $warningCount . ($warningCount === 1 ? ' warning' : ' warnings') . '</h2>';
else echo '<h2>Complete</h2>';
echo $now->format('Y-m-d h:i A');
