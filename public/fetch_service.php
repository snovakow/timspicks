<?php
require_once './fetch_lib.php';

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

/* Players */
if ($live && isset($_GET['players']) && isset($_GET['team'])) {
	$code = $_GET['team'];
	$url = 'https://api-web.nhle.com/v1/roster/' . $code . '/current';
	$response = file_get_contents($url);
	if ($response === false) {
		die('Error fetching NHL data: ' . $url);
	}

	$filename = 'players_' . $code . '.json';
	$filepath = './players/' . $filename;

	$dir = dirname($filepath);
	if (!is_dir($dir)) mkdir($dir, 0755, true);

	if (file_put_contents($filepath, $response) === false) {
		die('Error saving ' . $filepath . '<br>');
	}

	die($filename . '<br>');
}

/* History */
if ($live && isset($_GET['history'])) {
	echo '<h2>History</h2>';

	$ch = curl_init();

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
		['season' => '2023-2024', 'format' => 'regular', 'start' => '2023-10-10', 'end' => '2024-04-18'],
		['season' => '2023-2024', 'format' => 'playoff', 'start' => '2024-04-20', 'end' => '2024-06-24'],
		['season' => '2024-2025', 'format' => 'regular', 'start' => '2024-10-04', 'end' => '2025-04-17'],
		['season' => '2024-2025', 'format' => 'playoff', 'start' => '2025-04-19', 'end' => '2025-06-17'],
		['season' => '2025-2026', 'format' => 'regular', 'start' => '2025-10-07', 'end' => '2026-04-16'],
		['season' => '2025-2026', 'format' => 'playoff', 'start' => '2026-04-18', 'end' => '2026-05-10'],
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
				curl_setopt($ch, CURLOPT_URL, $baseURL . $date);

				$response = curl_exec($ch);
				if ($response === false) die('cURL Error: ' . curl_error($ch));

				$data = json_decode($response, false);
				if (json_last_error() !== JSON_ERROR_NONE) die('Error decoding JSON: ' . json_last_error_msg());

				if ($data->status === 404) {
					echo "No data for {$date}<br>";
					continue;
				}

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

/* Games */
if ($live) {
	$output = updateGames($now, $basePath);
	if (isset($output['title'])) echo '<h3>' . $output['title'] . '</h3>';
	if (isset($output['content'])) echo $output['content'];
	if (isset($output['error'])) die($output['error']);
}

$ch = curl_init();

/* Picks */
if ($live) {
	$output = updatePicks($ch, $basePath, $savesrc);
	if (isset($output['title'])) echo '<h3>' . $output['title'] . '</h3>';
	if (isset($output['content'])) echo $output['content'];
	if (isset($output['error'])) die($output['error']);
}

/* DraftKings */
if ($live) {
	$output = updateBet1($ch, $basePath, $savesrc);
	if (isset($output['title'])) echo '<h3>' . $output['title'] . '</h3>';
	if (isset($output['content'])) echo $output['content'];
	if (isset($output['error'])) die($output['error']);
}

$endOfDay = new DateTime('tomorrow midnight', $timezone);

/* FanDuel */
if ($live) {
	$output = updateBet2($endOfDay, $ch, $basePath, $savesrc);
	if (isset($output['title'])) echo '<h3>' . $output['title'] . '</h3>';
	if (isset($output['content'])) echo $output['content'];
	if (isset($output['error'])) die($output['error']);
}

/* BetMGM */
if ($live) {
	$output = updateBet3($endOfDay, $ch, $basePath, $savesrc);
	if (isset($output['title'])) echo '<h3>' . $output['title'] . '</h3>';
	if (isset($output['content'])) echo $output['content'];
	if (isset($output['error'])) die($output['error']);
}

/* BetRivers */
if ($live) {
	$output = updateBet4($endOfDay, $basePath, $savesrc);
	if (isset($output['title'])) echo '<h3>' . $output['title'] . '</h3>';
	if (isset($output['content'])) echo $output['content'];
	if (isset($output['error'])) die($output['error']);
}

/* Backup */
if ($live) {
	$output = backup($now, $timezone, $basePath);
	if (isset($output['title'])) echo '<h3>' . $output['title'] . '</h3>';
	if (isset($output['content'])) echo $output['content'];
	if (isset($output['error'])) die($output['error']);
}

echo "<h2>Complete</h2>";
echo $now->format('Y-m-d h:i A');
