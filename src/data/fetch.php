<?php
$live = true;
$secure = true;
$savesrc = false;
$debug = false;

if ($live && $secure) {
	session_start();

	if (!isset($_SESSION['csrf_token'])) die();

	$csrf_token = $_SESSION['csrf_token'];
	// unset($_SESSION['csrf_token']);

	if ($_SERVER['REQUEST_METHOD'] !== 'POST') die();

	$json_data = file_get_contents('php://input');

	$data = json_decode($json_data, true);

	if (!isset($data['code']) || !isset($data['name'])) die();
	if (!hash_equals($csrf_token, $data['csrf_token'])) die();
	if (!hash_equals('snovakow', $data['name']) || !hash_equals('sept2376', $data['code'])) die();
}

echo '<h1>Data Downloader</h1>';

/*

   Games

*/
if ($live && isset($_GET['games'])) {
	echo '<h2>Games</h2>';

	// Endpoint for today's schedule
	$date = new DateTime('now', new DateTimeZone('America/New_York'));
	$url = 'https://api-web.nhle.com/v1/schedule/' . $date->format('Y-m-d');
	echo "{$url}<br>";

	// Fetch the JSON data
	$response = file_get_contents($url);
	if ($response === false) {
		die('Error fetching NHL data: ' . $url);
	}

	if ($savesrc) file_put_contents('./src_games.json', $response);

	$data = json_decode($response, false);

	// Get games from the first day in the gameWeek structure (which is today)
	$games = $data->gameWeek[0]->games ?? [];

	if (empty($games)) {
		echo '<br>No games scheduled for today.<br>';
	} else {
		$pauseSeconds = 1; // Avoid hitting rate limits

		echo '<br>' . count($games) . ' games<br>';
		foreach ($games as $game) {
			sleep($pauseSeconds);
			$code = $game->homeTeam->abbrev;

			$url = 'https://api-web.nhle.com/v1/roster/' . $code . '/current';
			$response = file_get_contents($url);
			if ($response === false) {
				die('Error fetching NHL data: ' . $url);
			}

			if ($savesrc) file_put_contents('./src_games_' . $code . '.json', $response);

			$json = json_decode($response, false);

			$players = [];
			foreach ($json->forwards as $player) {
				$players[] = [
					"playerId" => $player->id,
					"headshot" => $player->headshot,
					"firstName" => $player->firstName,
					"lastName" => $player->lastName
				];
			}
			foreach ($json->defensemen as $player) {
				$players[] = [
					"playerId" => $player->id,
					"headshot" => $player->headshot,
					"firstName" => $player->firstName,
					"lastName" => $player->lastName
				];
			}
			$game->homeTeam->players = $players;

			sleep($pauseSeconds);
			$code = $game->awayTeam->abbrev;

			$url = 'https://api-web.nhle.com/v1/roster/' . $code . '/current';
			$response = file_get_contents($url);
			if ($response === false) {
				die('Error fetching NHL data: ' . $url);
			}

			if ($savesrc) file_put_contents('./src_games_' . $code . '.json', $response);

			$json = json_decode($response, false);

			$players = [];
			foreach ($json->forwards as $player) {
				$players[] = [
					"playerId" => $player->id,
					"headshot" => $player->headshot,
					"firstName" => $player->firstName,
					"lastName" => $player->lastName
				];
			}
			foreach ($json->defensemen as $player) {
				$players[] = [
					"playerId" => $player->id,
					"headshot" => $player->headshot,
					"firstName" => $player->firstName,
					"lastName" => $player->lastName
				];
			}
			$game->awayTeam->players = $players;
		}
	}

	$json_string = json_encode($games, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

	$local_file = './games.json';
	if (file_put_contents($local_file, $json_string) === false) {
		die('Error saving local JSON file.');
	}
	echo "<br>Data has been written to $local_file";
}

$ch = curl_init();

$timezone = new DateTimeZone('America/New_York');
$endOfDay = new DateTime('tomorrow midnight', $timezone);
$endOfDay = $endOfDay->getTimestamp();

/*

   Helper

*/
if ($live && isset($_GET['picks'])) {
	echo '<h2>Helper</h2>';

	$helper = 'https://api.hockeychallengehelper.com/api/picks';
	echo "{$helper}<br>";

	curl_setopt($ch, CURLOPT_URL, $helper);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
	curl_setopt($ch, CURLOPT_HTTPHEADER, [
		'accept: */*',
		'accept-language: en-US,en;q=0.9',
		'cache-control: no-cache',
		'origin: https://hockeychallengehelper.com',
		'pragma: no-cache',
		'priority: u=1, i',
		'sec-ch-ua: "Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
		'sec-ch-ua-mobile: ?0',
		'sec-ch-ua-platform: "macOS"',
		'sec-fetch-dest: empty',
		'sec-fetch-mode: cors',
		'sec-fetch-site: same-site',
		'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
	]);

	$response = curl_exec($ch);
	if ($response === false) echo 'cURL Error: ' . curl_error($ch);

	if ($savesrc) file_put_contents('./src_helper.json', $response);

	$json = json_decode($response, false);
	$json = $json->playerLists;
	$data = [];
	$data["1"] = [];
	$data["2"] = [];
	$data["3"] = [];

	foreach ($json as $item) {
		if ($item->id == 1) $array = &$data["1"];
		else if ($item->id == 2) $array = &$data["2"];
		else $array = &$data["3"];
		foreach ($item->players as $player) {
			$array[] = [
				"playerId" => $player->nhlPlayerId,
				"firstName" => $player->firstName,
				"lastName" => $player->lastName,
				"gamesPlayed" => $player->gamesPlayed,
				"goals" => $player->goals,
				"team" => $player->team
			];
		}
	}

	$json_string = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

	$local_file = './helper.json';
	if (file_put_contents($local_file, $json_string) === false) {
		die('Error saving local JSON file.');
	}
	echo "<br>Data has been written to $local_file";
}

/*

   DraftKings

*/
if ($live && isset($_GET['odds'])) {
	echo '<h2>DraftKings</h2>';

	$draftkings = 'https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=42133%2C13809&eventsQuery=%24filter%3DleagueId%20eq%20%2742133%27%20AND%20clientMetadata%2FSubcategories%2Fany%28s%3A%20s%2FId%20eq%20%2713809%27%29&marketsQuery=%24filter%3DclientMetadata%2FsubCategoryId%20eq%20%2713809%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&include=Events&entity=events';
	echo "{$draftkings}<br>";

	curl_reset($ch);

	curl_setopt($ch, CURLOPT_URL, $draftkings);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

	$response = curl_exec($ch);

	if ($response === false) die();

	if ($savesrc) file_put_contents('./src_draftkings.json', $response);

	$data = json_decode($response, false);
	$data = $data->selections;
	$map = [];

	foreach ($data as $selection) {
		$map[] = [
			"name" => $selection->participants[0]->seoIdentifier,
			"odds" => $selection->trueOdds
		];
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	$local_file = './draftkings.json';
	if (file_put_contents($local_file, $json_string) === false) die();

	echo "<br>Data has been written to $local_file";
}

/*

   FanDuel

*/
if ($live && isset($_GET['odds'])) {
	echo '<h2>FanDuel</h2>';

	$fanduel = 'https://sbapi.on.sportsbook.fanduel.ca/api/content-managed-page?page=CUSTOM&customPageId=nhl&pbHorizontal=false&_ak=FhMFpcPWXMeyZxOx&timezone=America%2FNew_York';
	echo "{$fanduel}<br>";

	curl_reset($ch);

	curl_setopt($ch, CURLOPT_URL, $fanduel);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
	curl_setopt($ch, CURLOPT_HTTPHEADER, [
		'accept: application/json',
		'accept-language: en-US,en;q=0.9',
		'cache-control: no-cache',
		'origin: https://on.sportsbook.fanduel.ca',
		'pragma: no-cache',
		'priority: u=1, i',
		'referer: https://on.sportsbook.fanduel.ca/',
		'sec-ch-ua: "Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
		'sec-ch-ua-mobile: ?0',
		'sec-ch-ua-platform: "macOS"',
		'sec-fetch-dest: empty',
		'sec-fetch-mode: cors',
		'sec-fetch-site: same-site',
		'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
		'x-px-context: _px3=98e6a5091287e11efd918ca990e430abc0584021256cf8912c9bcb6bd39af22a:5/CDG9AQvvmihGG6211Yz6LoC6LVM8My5tfqaG9gnVMqKdT/aa8JqT/v1hKZuq2vj9f2Xn41JinV1txRa1hwqQ==:1000:j0v9ImgsRNhSlmWiq5Iq7Ul2P05kFf2DV0BgnBgs26/1jNMN/NJz+3AHcZR70Z5ol1KzI3A43iGOWflKX3UauM9UFOoYID1q0nb339ot4lj6DxpuUk5Ye8W/IY4a3Nngwb6zMjAUz0ggBDGKXB2c5Y1C8DDEZZOT3KG/edd81LZa6KFt0ty9wtXwWiOH0h/kNxhlViyFIY38IT9BgD/7IoHdEsDSPd2GNmQL/XnaAQnxWpEKmj8l8kYr+wsMnpcO7VMZ/5ktJd759KqUXh9nANsZCz5g3OUUpOYBX0OhWvQyG7PNiNcakFf/QGzfp+YvsFgv8aC6d4ZjaNkb/fFnefZrZwlSk2nX61AI+bsZVa1M3R5DpjzlERPSr72eRbJdOTITEOpbkCgI38G0dbSD14HUC3Qmgoot9jjoTBQgg/33ipqvjc07wvr+F7rWKWCcU/a52zlcH5WQQtSAAOM4mSrS3MXZWApT6oF0BiMqDL0VFe+/oNurqKgqX2M1DexU;_pxvid=5e4ed398-1409-11f1-9c4c-73f30c9ee40b;pxcts=5e4edb9a-1409-11f1-9c4d-a70d1e54286e;',
		'x-sportsbook-region: ON',
	]);

	$response = curl_exec($ch);

	if ($response === false) die();

	if ($savesrc) file_put_contents('./src_fanduel.json', $response);

	$data = json_decode($response, false);
	$data = $data->attachments;
	$data = $data->markets;
	$map = [];
	foreach ($data as $market) {
		if ($market->marketType !== 'ANY_TIME_GOAL_SCORER') continue;

		$closingTime = DateTime::createFromFormat('Y-m-d\TH:i:s.ue', $market->marketTime);
		$closingTime = $closingTime->getTimestamp();
		if ($closingTime > $endOfDay) continue;

		foreach ($market->runners as $runner) {
			$num = $runner->winRunnerOdds->trueOdds->fractionalOdds->numerator;
			$den = $runner->winRunnerOdds->trueOdds->fractionalOdds->denominator;
			$trueOdds = $num / $den + 1;

			$map[] = [
				"name" => $runner->runnerName,
				"odds" => $trueOdds
			];
		}
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	$local_file = './fanduel.json';
	if (file_put_contents($local_file, $json_string) === false) die();

	echo "<br>Data has been written to $local_file";
}

/*

   BetRivers

*/
if ($live && isset($_GET['odds'])) {
	echo '<h2>BetRivers</h2>';
	$remote_url_base = 'https://on.betrivers.ca/api/service/sportsbook/offering/propcentral/offers?groupId=1000093657&marketCategory=TO_SCORE&pageSize=20&cageCode=249&t=' . time() . '&pageNr=';

	$remote_url = $remote_url_base . '1';
	echo "{$remote_url}<br>";
	$json_data = file_get_contents($remote_url);
	if ($json_data === false) {
		if ($debug) die('Error fetching remote JSON file.');
		else die();
	}

	if ($savesrc) file_put_contents('./src_betrivers1.json', $json_data);

	$data_array = json_decode($json_data, false);
	if (json_last_error() !== JSON_ERROR_NONE) {
		if ($debug) die('Error decoding JSON: ' . json_last_error_msg());
		else die();
	}

	if ($savesrc) $items = [$data_array->items];

	$map = [];
	foreach ($data_array->items as $item) {
		$closingTime = DateTime::createFromFormat('Y-m-d\TH:i:s.ue', $item->closingTime);
		$closingTime = $closingTime->getTimestamp();
		if ($closingTime > $endOfDay) continue;

		$map[] = [
			"name" => $item->playerInfo->name,
			"odds" => $item->outcomes[0]->odds
		];
	}

	$pages = $data_array->paging->totalPages;
	echo "<br>{$pages} pages<br>";
	for ($i = 2; $i <= $pages; $i++) {
		$remote_url = $remote_url_base . $i;
		$json_data = file_get_contents($remote_url);

		if ($json_data === false) die();

		if ($savesrc) file_put_contents('./src_betrivers' . $i . '.json', $json_data);

		$data_array = json_decode($json_data, false);
		if (json_last_error() !== JSON_ERROR_NONE) {
			if ($debug) die('Error decoding JSON: ' . json_last_error_msg());
			else die();
		}

		if ($savesrc) $items[] = $data_array->items;

		foreach ($data_array->items as $item) {
			$closingTime = DateTime::createFromFormat('Y-m-d\TH:i:s.ue', $item->closingTime);
			$closingTime = $closingTime->getTimestamp();
			if ($closingTime > $endOfDay) continue;

			$map[] = [
				"name" => $item->playerInfo->name,
				"odds" => $item->outcomes[0]->odds
			];
		}
	}

	if ($savesrc) {
		$items = array_merge([], ...$items);
		$json_string = json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
		file_put_contents('./src_betrivers.json', $json_string, LOCK_EX);
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	$local_file = './betrivers.json';

	if (file_put_contents($local_file, $json_string, LOCK_EX) === false) die();

	echo "<br>Data has been merged and written to $local_file";
}

/*

   5V5Hockey

*/
if ($live && isset($_GET['odds'])) {
	echo '<h2>5v5Hockey</h2>';
	$remote_url = 'https://5v5hockey.com/ai-betting/tims-picks/';

	echo "{$remote_url}<br>";
	$data = file_get_contents($remote_url);

	if ($data === false) die();

	if ($savesrc) file_put_contents('./src_5v5hockey.json', $data);

	$start = strpos($data, 'const table_1_data');
	if ($start === false) die();

	$end = strpos($data, 'gridTimsPicks(');
	if ($end === false) die();

	$data = substr($data, $start, $end - $start);

	$data = str_replace('const table_1_data = ', 'export const table_1_data = ', $data);
	$data = str_replace('const table_2_data = ', 'export const table_2_data = ', $data);
	$data = str_replace('const table_3_data = ', 'export const table_3_data = ', $data);

	$local_file = './5v5hockey.ts';
	if (file_put_contents($local_file, $data, LOCK_EX) === false) die();

	echo "<br>Data has been written to $local_file";
}
