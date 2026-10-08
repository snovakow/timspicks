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

/* History */
if ($live && isset($_GET['history'])) {
	echo '<h2>History</h2>';

	$ch = curl_init();
	$searchCh = curl_init(); // Player search for missing ids, separate so $ch keeps its pick-list feed headers

	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
	curl_setopt($ch, CURLOPT_HTTPHEADER, [
		'accept: */*',
		'accept-language: en-US,en;q=0.9',
		'cache-control: no-cache',
		'origin: https://hockeychallengehelper.com',
		'pragma: no-cache',
		'priority: u=1, i',
		'sec-ch-ua: "Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
		'sec-ch-ua-mobile: ?0',
		'sec-ch-ua-platform: "macOS"',
		'sec-fetch-dest: empty',
		'sec-fetch-mode: cors',
		'sec-fetch-site: same-site',
		'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
	]);

	$baseHistoryPath = './history';
	if (!is_dir($baseHistoryPath)) mkdir($baseHistoryPath, 0755, true);

	$datesTotal = [
		// ['season' => '2023-2024', 'format' => 'regular', 'start' => '2023-10-10', 'end' => '2024-04-18'],
		// ['season' => '2023-2024', 'format' => 'playoff', 'start' => '2024-04-20', 'end' => '2024-06-24'],
		// ['season' => '2024-2025', 'format' => 'regular', 'start' => '2024-10-04', 'end' => '2025-04-17'],
		// ['season' => '2024-2025', 'format' => 'playoff', 'start' => '2025-04-19', 'end' => '2025-06-17'],
		// ['season' => '2025-2026', 'format' => 'regular', 'start' => '2025-10-07', 'end' => '2026-04-16'],
		// History only began recording on 2026-04-09, so the 2025-2026 regular season starts there rather than 2025-10-07
		['season' => '2025-2026', 'format' => 'regular', 'start' => '2026-04-09', 'end' => '2026-04-16'],
		['season' => '2025-2026', 'format' => 'playoff', 'start' => '2026-04-18', 'end' => '2026-06-14'],
		// 2026-09-29 and 2026-09-30 odds were backfilled from recovered closing lines (cron was off)
		['season' => '2026-2027', 'format' => 'regular', 'start' => '2026-09-29', 'end' => '2026-10-07'],
	];

	$index_file = $baseHistoryPath . '/history.json';
	$data = file_get_contents($index_file);
	if ($data === false) {
		$datesProcess = &$datesTotal;
	} else {
		$datesStored = json_decode($data, true);
		if (json_last_error() === JSON_ERROR_NONE) {
			$datesProcess = [];
			$datesStoredCount = count($datesStored);
			$startIndex = min($datesStoredCount, count($datesTotal));

			// Preserve files from already-processed entries.
			for ($i = 0; $i < $datesStoredCount && $i < count($datesTotal); $i++) {
				if (isset($datesStored[$i]['files']) && is_array($datesStored[$i]['files'])) {
					$datesTotal[$i]['files'] = &$datesStored[$i]['files'];
				}
			}

			// Check only the last stored range and extend from its end date if needed.
			if ($datesStoredCount > 0 && $datesStoredCount <= count($datesTotal)) {
				$lastIndex = $datesStoredCount - 1;
				$lastStoredEntry = &$datesStored[$lastIndex];
				$lastTotalEntry = &$datesTotal[$lastIndex];

				$storedEnd = isset($lastStoredEntry['end']) ? $lastStoredEntry['end'] : null;
				$totalEnd = $lastTotalEntry['end'];

				if ($storedEnd !== null && $storedEnd !== $totalEnd) {
					$extendStart = (new DateTime($storedEnd))->add(new DateInterval('P1D'))->format('Y-m-d');
					if ($extendStart <= $totalEnd) {
						$startIndex = $lastIndex;
						$lastTotalEntry['process_start'] = $extendStart;
					}
				}
			}

			// Add entries to process (new ones and any incomplete last entry)
			for ($i = $startIndex; $i < count($datesTotal); $i++) {
				$datesProcess[] = &$datesTotal[$i];
			}
		} else {
			$datesProcess = &$datesTotal;
		}
	}

	if (count($datesProcess) === 0) {
		die("No new data to fetch. Index is up to date.");
	} else {
		$baseURL = 'https://api.hockeychallengehelper.com/api/history?datetime=';
		$format = 'Y-m-d';
		$interval = new DateInterval('P1D'); // 1 day interval

		foreach ($datesProcess as &$dateRange) {
			echo "Season: {$dateRange['season']}<br>";
			echo "Format: {$dateRange['format']}<br>";
			echo "Start: {$dateRange['start']}<br>";
			echo "End: {$dateRange['end']}<br>";
			echo "<br>";

			$season = $dateRange['season'];
			$part = $dateRange['format'];
			$start = isset($dateRange['process_start']) ? $dateRange['process_start'] : $dateRange['start'];
			$end = $dateRange['end'];

			echo "Fetching from: $start<br>";

			$realEnd = new DateTime($end);
			$realEnd->add($interval); // Include the end date in the range

			$period = new DatePeriod(new DateTime($start), $interval, $realEnd);

			if (!isset($dateRange['files']) || !is_array($dateRange['files'])) {
				$dateRange['files'] = [];
			}
			$files = &$dateRange['files'];

			$datesToFetch = [];
			foreach ($period as $dateObj) {
				$datesToFetch[] = $dateObj->format($format);
			}

			foreach ($datesToFetch as $date) {
				$url = $baseURL . $date;
				curl_setopt($ch, CURLOPT_URL, $url);

				$fetched = fetchCurl($ch, $url);

				// A day the challenge didn't run answers 404, which is normal across an off-season gap.
				// Every other failure has to stop the range: an error envelope parses as JSON and carries
				// its own status, so letting one through would save it as that day's history and record
				// the day as fetched, and the range is never walked again.
				if ($fetched['status'] === 404) {
					echo "No data for {$date}<br>";
					continue;
				}
				if ($fetched['error'] !== null) die($fetched['error']);

				$response = $fetched['body'];
				$data = json_decode($response, false);
				if (json_last_error() !== JSON_ERROR_NONE) die('Error decoding JSON: ' . json_last_error_msg());

				// Belt and braces, in case a 200 ever carries that envelope
				if (($data->status ?? null) === 404) {
					echo "No data for {$date}<br>";
					continue;
				}

				// Save the ids the picks fetch used, so this file matches that day's helper.json backups
				$fixed = fixHistoryPlayerIds($searchCh, $data);
				foreach ($fixed['notes'] as $note) echo '<p class="warning">Warning: ' . htmlspecialchars($note, ENT_QUOTES, 'UTF-8') . '</p>';
				if ($fixed['changed']) $response = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

				$filename = "{$season}_{$date}_{$part}.json";
				$daily_file = $baseHistoryPath . '/' . $filename;
				if (file_put_contents($daily_file, $response) !== false) {
					$files[] = $filename;
					echo "$filename<br>";
				} else {
					echo "Failed to save $filename<br>";
				}
			}
			echo "<br>";
			unset($dateRange['process_start']);
		}

		$json_string = json_encode($datesTotal, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

		if (file_put_contents($index_file, $json_string) === false) {
			die('Error saving local JSON file.');
		}
		echo "Index has been written to $index_file";
	}

	die("<h2>Complete</h2>");
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

$ch = curl_init();

/* Picks */
if ($live) {
	$output = updatePicks($ch, $basePath, './players', $savesrc);
	$warnings = array_merge($warnings, printOutput($output));
}

/* DraftKings */
if ($live) {
	$output = updateBet1($ch, $basePath, $savesrc);
	$warnings = array_merge($warnings, printOutput($output));
}

$endOfDay = new DateTime('tomorrow midnight', $timezone);

/* FanDuel */
if ($live) {
	$output = updateBet2($endOfDay, $ch, $basePath, $savesrc);
	$warnings = array_merge($warnings, printOutput($output));
}

/* BetMGM */
if ($live) {
	$output = updateBet3($endOfDay, $ch, $basePath, $savesrc);
	$warnings = array_merge($warnings, printOutput($output));
}

/* BetRivers */
if ($live) {
	$output = updateBet4($endOfDay, $basePath, $savesrc);
	$warnings = array_merge($warnings, printOutput($output));
}

/* Backup */
if ($live) {
	$output = backup($now, $timezone, $basePath, $warnings);
	$warnings = array_merge($warnings, printOutput($output));
}

$warningCount = count($warnings);
if ($warningCount) echo '<h2 class="warning">Complete with ' . $warningCount . ($warningCount === 1 ? ' warning' : ' warnings') . '</h2>';
else echo '<h2>Complete</h2>';
echo $now->format('Y-m-d h:i A');
