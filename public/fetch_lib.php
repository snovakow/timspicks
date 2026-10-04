<?php

/*
	Two callers: fetch_service.php in this folder, and update.php, which lives in its own tree and is
	copied to the server separately. Nothing builds or type-checks that pairing, so every parameter
	added to a function here carries a default — a required one breaks the cron silently.
*/

/* A fetch's body, or the status or empty body that came back instead of one. Every feed here answers
   with JSON, so this has to run before json_decode reports an outage as "Error decoding JSON". */
function fetchCurl(CurlHandle $ch, string $url)
{
	$response = curl_exec($ch);
	if ($response === false) return ['body' => null, 'status' => null, 'error' => 'cURL Error: ' . curl_error($ch)];

	$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
	if ($status < 200 || $status > 299) return ['body' => null, 'status' => $status, 'error' => "HTTP $status from $url"];
	if (trim($response) === '') return ['body' => null, 'status' => $status, 'error' => "Empty response from $url (HTTP $status)"];

	return ['body' => $response, 'status' => $status, 'error' => null];
}

/* The same for the http stream wrapper, which fails a non-2xx itself but only as a PHP warning, so the
   status has to be read back out of the headers it leaves behind */
function fetchUrl(string $url)
{
	$response = @file_get_contents($url);

	$status = null;
	foreach ($http_response_header ?? [] as $header) {
		if (preg_match('#^HTTP/\S+ (\d{3})#', $header, $match)) $status = (int)$match[1];
	}
	$detail = $status === null ? '' : " (HTTP $status)";

	if ($response === false) return ['body' => null, 'status' => $status, 'error' => "Fetch failed from $url$detail"];
	if (trim($response) === '') return ['body' => null, 'status' => $status, 'error' => "Empty response from $url$detail"];

	return ['body' => $response, 'status' => $status, 'error' => null];
}

/* Games */
function updateGames(DateTime $now, string $basePath)
{
	$output = ['title' => null, 'content' => null, 'error' => null];
	$output['title'] = 'Games';

	// Endpoint for today's schedule
	$url = 'https://api-web.nhle.com/v1/schedule/' . $now->format('Y-m-d');
	$local_file = $basePath . '/games.json';

	// Fetch the JSON data
	$fetched = fetchUrl($url);
	if ($fetched['error'] !== null) {
		$output['error'] = $fetched['error'];
		return $output;
	}
	$response = $fetched['body'];

	if (file_put_contents($local_file, $response, LOCK_EX) === false) {
		$output['error'] = 'Error saving local JSON file: ' . $local_file;
		return $output;
	}
	$output['content'] = "Data has been written to $local_file";
	return $output;
}

/* Cached player data is refreshed when missing or when the player changes teams */
function playerFileCurrent(string $local_file, string $team)
{
	if (!file_exists($local_file)) return false;

	$data = file_get_contents($local_file);
	if ($data === false) return false;

	$data = json_decode($data, false);
	return isset($data->currentTeamAbbrev) && $data->currentTeamAbbrev === $team;
}

/* Manual player ids for pick-list entries with a missing or wrong id, keyed by the full name in the pick-list feed */
const PLAYER_ID_OVERRIDES = [
	'Oskar Back' => 8480840, // The pick-list feed sends id 0
];

/* Lowercase ASCII without punctuation, so "Oskar Bäck" matches "Oskar Back" and "J.T. Miller" matches "JT Miller" */
function normalizePlayerName(string $name)
{
	$ascii = function_exists('transliterator_transliterate')
		? transliterator_transliterate('Any-Latin; Latin-ASCII', $name)
		: iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $name);
	if ($ascii !== false) $name = $ascii;

	$name = preg_replace('/[^a-z0-9\s-]/', '', strtolower($name));
	return trim(preg_replace('/[\s-]+/', ' ', $name));
}

/* Look up a player id in the player search when the pick-list feed doesn't supply one */
function resolvePlayerId(CurlHandle $ch, string $firstName, string $lastName, string $team)
{
	$first = normalizePlayerName($firstName);
	$last = normalizePlayerName($lastName);
	if ($first === '' || $last === '') return ['id' => 0, 'detail' => 'name missing from the pick-list feed'];
	$target = "$first $last";

	curl_reset($ch);
	$url = 'https://search.d3.nhle.com/api/v1/search/player?' . http_build_query([
		'culture' => 'en-us',
		'limit' => 20,
		'q' => "$firstName $lastName",
		'active' => 'true',
	]);
	curl_setopt($ch, CURLOPT_URL, $url);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
	curl_setopt($ch, CURLOPT_TIMEOUT, 10);

	$fetched = fetchCurl($ch, $url);
	if ($fetched['error'] !== null) return ['id' => 0, 'detail' => "player search failed: {$fetched['error']}"];

	$results = json_decode($fetched['body'], false);
	if (!is_array($results)) return ['id' => 0, 'detail' => "player search returned an invalid response (HTTP {$fetched['status']})"];

	$candidates = [];
	foreach ($results as $result) {
		if (!isset($result->playerId, $result->name)) continue;
		$candidates[] = [
			'id' => (int)$result->playerId,
			'name' => normalizePlayerName($result->name),
			'team' => $result->teamAbbrev ?? null,
			'label' => $result->name . ', ' . ($result->teamAbbrev ?? 'no team'),
		];
	}

	// Exact name on the team, then first initial and last name on the team (Jake/Jacob), then exact name on any team (stale search team).
	// A pass only counts when exactly one player matches, so two players with the same name are skipped rather than guessed.
	$passes = [
		fn($c) => $c['team'] === $team && $c['name'] === $target,
		fn($c) => $c['team'] === $team && str_starts_with($c['name'], $first[0]) && str_ends_with($c['name'], " $last"),
		fn($c) => $c['name'] === $target,
	];
	$mostMatches = 0;
	foreach ($passes as $pass) {
		$matches = array_values(array_filter($candidates, $pass));
		if (count($matches) === 1) return ['id' => $matches[0]['id'], 'detail' => "matched {$matches[0]['label']} in the player search"];
		$mostMatches = max($mostMatches, count($matches));
	}
	return ['id' => 0, 'detail' => $mostMatches ? "$mostMatches possible matches in the player search" : 'no match in the player search'];
}

/* Player id for a pick-list player: the manual override, else the feed's id, else the player search (0 if none),
   with a note whenever the id didn't come straight from the feed */
function nhlPlayerId(CurlHandle $ch, string $firstName, string $lastName, string $team, int $helperId)
{
	$overrideId = PLAYER_ID_OVERRIDES["$firstName $lastName"] ?? 0;
	if ($overrideId) {
		if (!$helperId) return ['id' => $overrideId, 'note' => null];
		$note = $overrideId === $helperId ? 'override matches the pick-list feed id and can be removed' : "pick-list feed id $helperId overridden with $overrideId";
		return ['id' => $overrideId, 'note' => $note];
	}
	if ($helperId) return ['id' => $helperId, 'note' => null];

	$resolved = resolvePlayerId($ch, $firstName, $lastName, $team);
	$note = $resolved['id'] ? "resolved missing player id to {$resolved['id']} ({$resolved['detail']})" : "missing player id, {$resolved['detail']}";
	return ['id' => $resolved['id'], 'note' => $note];
}

/* Give a history file's players the ids the picks fetch uses, so history files match the helper.json backups */
function fixHistoryPlayerIds(CurlHandle $ch, object $history)
{
	$result = ['changed' => 0, 'notes' => []];
	foreach ($history->playerLists ?? [] as $list) {
		foreach ($list->players ?? [] as $player) {
			[$firstName, $lastName] = array_pad(explode(' ', trim((string)($player->fullName ?? '')), 2), 2, '');
			$team = (string)($player->team ?? '');
			$helperId = abs((int)($player->nhlPlayerId ?? 0));

			$fixed = nhlPlayerId($ch, $firstName, $lastName, $team, $helperId);
			if ($fixed['note']) $result['notes'][] = "$firstName $lastName ($team): {$fixed['note']}";
			if ($fixed['id'] && $fixed['id'] !== $helperId) {
				$player->nhlPlayerId = $fixed['id'];
				$result['changed']++;
			}
		}
	}
	return $result;
}

/* Picks */
function updatePicks(CurlHandle $ch, string $basePath, string $playerPath, bool $savesrc = false)
{
	$output = ['title' => null, 'content' => null, 'warning' => [], 'error' => null];
	$output['title'] = 'Picks';

	$helper = 'https://api.hockeychallengehelper.com/api/picks';

	curl_reset($ch);

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

	$fetched = fetchCurl($ch, $helper);
	if ($fetched['error'] !== null) {
		$output['error'] = $fetched['error'];
		return $output;
	}
	$response = $fetched['body'];

	if ($savesrc) file_put_contents($basePath . '/src_helper.json', $response);

	$json = json_decode($response, false);
	if (json_last_error() !== JSON_ERROR_NONE) {
		$output['error'] = "Error decoding JSON from $helper: " . json_last_error_msg();
		return $output;
	}
	if (!isset($json->playerLists)) {
		$output['error'] = "Missing playerLists in response from $helper";
		return $output;
	}
	// When the feed made this draw, in ET with no offset. The day's first draw is stamped midnight,
	// so a date other than today's is a list still left over from an earlier day
	$drawn = isset($json->dateTimeAvailable) && is_string($json->dateTimeAvailable) ? $json->dateTimeAvailable : null;

	$json = $json->playerLists;
	$data = [];
	$data["1"] = [];
	$data["2"] = [];
	$data["3"] = [];
	if ($drawn !== null) $data["dateTimeAvailable"] = $drawn;

	if (!is_dir($playerPath)) mkdir($playerPath, 0755, true);
	foreach ($json as $item) {
		if ($item->id == 1) $array = &$data["1"];
		else if ($item->id == 2) $array = &$data["2"];
		else $array = &$data["3"];
		foreach ($item->players as $player) {
			$firstName = trim((string)($player->firstName ?? ''));
			$lastName = trim((string)($player->lastName ?? ''));
			$team = (string)($player->team ?? '');

			$fixed = nhlPlayerId($ch, $firstName, $lastName, $team, abs((int)($player->nhlPlayerId ?? 0)));
			$playerId = $fixed['id'];
			if ($fixed['note']) $output['warning'][] = ($playerId ? '' : 'Skipped ') . "$firstName $lastName ($team): {$fixed['note']}";
			if (!$playerId) continue;

			$local_file = "{$playerPath}/{$playerId}.json";
			if (!playerFileCurrent($local_file, $team)) {
				$url = "https://api-web.nhle.com/v1/player/{$playerId}/landing";

				$fetched = fetchUrl($url);
				if ($fetched['error'] !== null) {
					$output['error'] = $fetched['error'];
					return $output;
				}
				$response = $fetched['body'];

				if (file_put_contents($local_file, $response, LOCK_EX) === false) {
					$output['error'] = 'Error saving local player JSON file: ' . $local_file;
					return $output;
				}
			}

			$array[] = [
				"playerId" => $playerId,
				"firstName" => $firstName,
				"lastName" => $lastName,
				"gamesPlayed" => $player->gamesPlayed,
				"goals" => $player->goals,
				"team" => $team
			];
		}
	}

	$json_string = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
	$local_file = $basePath . '/helper.json';
	if (file_put_contents($local_file, $json_string, LOCK_EX) === false) {
		$output['error'] = 'Error saving local JSON file: ' . $local_file;
		return $output;
	}
	$output['content'] = "Data has been written to $local_file";
	return $output;
}

/* DraftKings */
function updateBet1(CurlHandle $ch, string $basePath, bool $savesrc = false)
{
	$output = ['title' => null, 'content' => null, 'error' => null];
	$output['title'] = 'DraftKings';

	$draftkings = 'https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=42133%2C14495&eventsQuery=%24filter%3DleagueId%20eq%20%2742133%27%20AND%20clientMetadata%2FSubcategories%2Fany%28s%3A%20s%2FId%20eq%20%2714495%27%29&marketsQuery=%24filter%3DclientMetadata%2FsubCategoryId%20eq%20%2714495%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&include=Events&entity=events';
	$local_file = $basePath . '/bet1.json';

	curl_reset($ch);

	curl_setopt($ch, CURLOPT_URL, $draftkings);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
	curl_setopt($ch, CURLOPT_HTTPHEADER, [
		'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
		'accept-language: en-US,en;q=0.9',
		'cache-control: max-age=0',
		'priority: u=0, i',
		'sec-ch-ua: "Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
		'sec-ch-ua-mobile: ?0',
		'sec-ch-ua-platform: "macOS"',
		'sec-fetch-dest: document',
		'sec-fetch-mode: navigate',
		'sec-fetch-site: none',
		'sec-fetch-user: ?1',
		'upgrade-insecure-requests: 1',
		'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
	]);

	$fetched = fetchCurl($ch, $draftkings);
	if ($fetched['error'] !== null) {
		$output['error'] = $fetched['error'];
		return $output;
	}
	$response = $fetched['body'];

	if ($savesrc) file_put_contents($basePath . '/src_bet1.json', $response);

	$data = json_decode($response, false);
	if (json_last_error() !== JSON_ERROR_NONE) {
		$output['error'] = "Error decoding JSON from $draftkings: " . json_last_error_msg();
		return $output;
	}
	if (!isset($data->selections)) {
		$output['error'] = "Missing selections in response from $draftkings";
		return $output;
	}
	$map = [];

	// One Anytime Goalscorer market per game
	$marketIds = [];
	foreach ($data->markets as $market) {
		if ($market->marketType->name === "Anytime Goalscorer") $marketIds[$market->id] = true;
	}

	foreach ($data->selections as $selection) {
		if (isset($selection->outcomeType) && $selection->outcomeType !== "ToScoreAnyTime") continue;
		if (!isset($marketIds[$selection->marketId])) continue;
		$map[] = [
			"name" => $selection->participants[0]->seoIdentifier ?? $selection->participants[0]->name,
			"odds" => $selection->trueOdds
		];
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
	if (file_put_contents($local_file, $json_string, LOCK_EX) === false) {
		$output['error'] = 'Error saving local JSON file: ' . $local_file;
		return $output;
	}

	$output['content'] = "Data has been written to $local_file";
	return $output;
}

/* FanDuel */
function updateBet2(DateTime $endOfDay, CurlHandle $ch, string $basePath, bool $savesrc = false)
{
	$output = ['title' => null, 'content' => null, 'error' => null];
	$output['title'] = 'FanDuel';

	$fanduel = 'https://sbapi.on.sportsbook.fanduel.ca/api/content-managed-page?page=CUSTOM&customPageId=nhl&pbHorizontal=false&_ak=FhMFpcPWXMeyZxOx&timezone=America%2FNew_York';
	$local_file = $basePath . '/bet2.json';

	$headers = [
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
	];

	curl_reset($ch);

	curl_setopt($ch, CURLOPT_URL, $fanduel);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
	curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

	$fetched = fetchCurl($ch, $fanduel);
	if ($fetched['error'] !== null) {
		$output['error'] = $fetched['error'];
		return $output;
	}
	$response = $fetched['body'];

	if ($savesrc) file_put_contents($basePath . '/src_bet2.json', $response);

	$data = json_decode($response, false);
	if (json_last_error() !== JSON_ERROR_NONE) {
		$output['error'] = "Error decoding JSON from $fanduel: " . json_last_error_msg();
		return $output;
	}
	if (!isset($data->attachments->markets)) {
		$output['error'] = "Missing markets in response from $fanduel";
		return $output;
	}

	// The NHL page lists today's games, goal scorer markets are on each game's own page
	$eventIds = [];
	foreach ($data->attachments->markets as $market) {
		if ($market->marketType !== 'MONEY_LINE') continue;
		$closingTime = DateTime::createFromFormat('Y-m-d\TH:i:s.ue', $market->marketTime);
		if (!$closingTime) continue;
		if ($closingTime > $endOfDay) continue;
		$eventIds[$market->eventId] = true;
	}

	$map = [];
	foreach (array_keys($eventIds) as $eventId) {
		$url = 'https://sbapi.on.sportsbook.fanduel.ca/api/event-page?_ak=FhMFpcPWXMeyZxOx&eventId=' . $eventId . '&tab=goals';

		curl_reset($ch);

		curl_setopt($ch, CURLOPT_URL, $url);
		curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
		curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
		curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

		$fetched = fetchCurl($ch, $url);
		if ($fetched['error'] !== null) {
			$output['error'] = $fetched['error'];
			return $output;
		}
		$response = $fetched['body'];

		if ($savesrc) file_put_contents($basePath . '/src_bet2_' . $eventId . '.json', $response);

		$event = json_decode($response, false);
		if (json_last_error() !== JSON_ERROR_NONE) {
			$output['error'] = "Error decoding JSON from $url: " . json_last_error_msg();
			return $output;
		}

		$markets = [];
		foreach ($event->attachments->markets ?? [] as $market) {
			if ($market->marketType !== 'ANY_TIME_GOAL_SCORER') continue;
			$markets[] = $market;
		}
		if (count($markets) > 1) {
			$list = [];
			foreach ($markets as $market) {
				if ($market->marketName !== 'Any Time Goal Scorer' && $market->marketName !== 'Anytime Goal Scorer') continue;
				$list[] = $market;
			}
			$markets = $list;
		}
		if (count($markets) > 1) {
			$list = [];
			foreach ($markets as $market) {
				if (!isset($market->marketLevels)) continue;
				if ($market->marketLevels[0] !== 'AVB_EVENT') continue;
				$list[] = $market;
			}
			$markets = $list;
		}

		foreach ($markets as $market) {
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
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
	if (file_put_contents($local_file, $json_string, LOCK_EX) === false) {
		$output['error'] = 'Error saving local JSON file: ' . $local_file;
		return $output;
	}

	$output['content'] = count($eventIds) . " games of data have been merged and written to $local_file";
	return $output;
}

/* BetMGM */
function updateBet3(DateTime $endOfDay, CurlHandle $ch, string $basePath, bool $savesrc = false)
{
	$output = ['title' => null, 'content' => null, 'error' => null];
	$output['title'] = 'BetMGM';

	$remote_url = 'https://www.on.betmgm.ca/cds-api/bettingoffer/fixtures?x-bwin-accessid=MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy&lang=en-us&country=CA&userCountry=CA&subdivision=CA-Ontario&fixtureTypes=Standard&state=Latest&offerMapping=Filtered&offerCategories=Gridable&fixtureCategories=Gridable,NonGridable,Other&sportIds=12&isPriceBoost=false&statisticsModes=None&skip=0&take=50&sortBy=Tags';
	$local_file = $basePath . '/bet3.json';

	curl_reset($ch);

	curl_setopt($ch, CURLOPT_URL, $remote_url);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
	curl_setopt($ch, CURLOPT_HTTPHEADER, [
		'accept: application/json, text/plain, */*',
		'accept-language: en-US,en;q=0.9',
		'cache-control: no-cache',
		'pragma: no-cache',
		'priority: u=1, i',
		'referer: https://www.on.betmgm.ca/en/sports/hockey-12',
		'sec-ch-ua: "Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
		'sec-ch-ua-mobile: ?0',
		'sec-ch-ua-platform: "macOS"',
		'sec-fetch-dest: empty',
		'sec-fetch-mode: cors',
		'sec-fetch-site: same-origin',
		'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
		'x-bwin-browser-url: https://www.on.betmgm.ca/en/sports/hockey-12',
		'x-device-type: desktop_OS X',
		'x-from-product: host-app',
	]);

	$fetched = fetchCurl($ch, $remote_url);
	if ($fetched['error'] !== null) {
		$output['error'] = $fetched['error'];
		return $output;
	}
	$response = $fetched['body'];

	if ($savesrc) file_put_contents($basePath . '/src_bet3_0.json', $response);
	$json_data = json_decode($response, false);
	if (json_last_error() !== JSON_ERROR_NONE) {
		$output['error'] = "Error decoding JSON from $remote_url: " . json_last_error_msg();
		return $output;
	}
	if (!isset($json_data->fixtures)) {
		$output['error'] = "Missing fixtures in response from $remote_url";
		return $output;
	}

	$ids = [];
	foreach ($json_data->fixtures as $fixture) {
		if ($fixture->competition->name->value !== 'NHL') continue;

		$closingTime = DateTime::createFromFormat('Y-m-d\TH:i:se', $fixture->startDate);
		if (!$closingTime) {
			$output['error'] = "Invalid date format in response: " . $fixture->startDate;
			return $output;
		}
		if ($closingTime > $endOfDay) continue;

		$ids[] = $fixture->id;
	}

	if ($savesrc) $items = [];

	$map = [];
	foreach ($ids as $id) {
		curl_reset($ch);

		$url = 'https://www.on.betmgm.ca/cds-api/bettingoffer/fixture-view?x-bwin-accessid=MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy&lang=en-us&country=CA&userCountry=CA&subdivision=CA-Ontario&offerMapping=All&scoreboardMode=Full&fixtureIds=' . $id . '&state=Latest&includePrecreatedBetBuilder=true&supportVirtual=true&isBettingInsightsEnabled=true&useRegionalisedConfiguration=true&includeRelatedFixtures=false&statisticsModes=Rank,Pitchers&firstMarketGroupOnly=false';
		curl_setopt($ch, CURLOPT_URL, $url);
		curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
		curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
		curl_setopt($ch, CURLOPT_HTTPHEADER, [
			'accept: application/json, text/plain, */*',
			'accept-language: en-US,en;q=0.9',
			'cache-control: no-cache',
			'pragma: no-cache',
			'priority: u=1, i',
			'referer: https://www.on.betmgm.ca/en/sports/events/carolina-hurricanes-at-toronto-maple-leafs-19046169?tab=score',
			'sec-ch-ua: "Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
			'sec-ch-ua-mobile: ?0',
			'sec-ch-ua-platform: "macOS"',
			'sec-fetch-dest: empty',
			'sec-fetch-mode: cors',
			'sec-fetch-site: same-origin',
			'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
			'x-bwin-browser-url: https://www.on.betmgm.ca/en/sports/events/carolina-hurricanes-at-toronto-maple-leafs-19046169?tab=score',
			'x-device-type: desktop_OS X',
			'x-from-product: host-app',
		]);

		$fetched = fetchCurl($ch, $url);
		if ($fetched['error'] !== null) {
			$output['error'] = $fetched['error'];
			return $output;
		}
		$response = $fetched['body'];

		if ($savesrc) file_put_contents($basePath . '/src_bet3_' . $id . '.json', $response);

		$json_data = json_decode($response, false);
		if (json_last_error() !== JSON_ERROR_NONE) {
			$output['error'] = "Error decoding JSON from $url: " . json_last_error_msg();
			return $output;
		}

		foreach ($json_data->fixture->games ?? [] as $game) {
			if ($game->name->value !== "Anytime goalscorer") continue;
			$data_array = $game->results;

			if ($savesrc) $items[] = $data_array;

			foreach ($data_array as $result) {
				$map[] = [
					"name" => $result->name->value,
					"odds" => $result->odds
				];
			}
		}

		// Newer fixture format lists markets under optionMarkets
		foreach ($json_data->fixture->optionMarkets ?? [] as $market) {
			if ($market->name->value !== "Anytime goalscorer") continue;
			$data_array = $market->options;

			if ($savesrc) $items[] = $data_array;

			foreach ($data_array as $option) {
				$map[] = [
					"name" => $option->name->value,
					"odds" => $option->price->odds
				];
			}
		}
	}

	if ($savesrc && isset($items)) {
		$items = array_merge([], ...$items);
		$json_string = json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
		file_put_contents($basePath . '/src_bet3.json', $json_string);
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
	if (file_put_contents($local_file, $json_string, LOCK_EX) === false) {
		$output['error'] = 'Error saving local JSON file: ' . $local_file;
		return $output;
	}

	$output['content'] = count($ids) . " games of data have been merged and written to $local_file";
	return $output;
}

/* BetRivers */
function updateBet4(DateTime $endOfDay, string $basePath, bool $savesrc = false)
{
	$output = ['title' => null, 'content' => null, 'warning' => [], 'error' => null];
	$output['title'] = 'BetRivers';

	$remote_url_base = 'https://on.betrivers.ca/api/service/sportsbook/offering/propcentral/offers?groupId=1000093657&marketCategory=TO_SCORE&pageSize=20&cageCode=249&t=' . time() . '&pageNr=';
	$local_file = $basePath . '/bet4.json';

	$remote_url = $remote_url_base . '1';

	$fetched = fetchUrl($remote_url);
	$json_data = $fetched['body'];
	$map = [];
	if ($json_data === null) {
		// Tolerated as "no offers today", the way it always has been, but it should not pass for a quiet day
		$output['warning'][] = "No offers recorded: {$fetched['error']}";
		$pages = 0;
	} else {
		if ($savesrc) file_put_contents($basePath . '/src_bet4_1.json', $json_data);

		$data_array = json_decode($json_data, false);
		if (json_last_error() !== JSON_ERROR_NONE) {
			$output['error'] = "Error decoding JSON from $remote_url: " . json_last_error_msg();
			return $output;
		}

		if ($savesrc) $items = [$data_array->items];

		if (!isset($data_array->items)) {
			$output['error'] = "Missing items in response from page 1 of $remote_url_base";
			return $output;
		}

		foreach ($data_array->items as $item) {
			// Newer responses nest the closing time and odds under betOffers
			$offer = $item->betOffers[0] ?? $item;
			$closingTime = DateTime::createFromFormat('Y-m-d\TH:i:s.ue', $offer->closingTime);
			if (!$closingTime) {
				$output['error'] = "Invalid date format in response: " . $offer->closingTime;
				return $output;
			}
			if ($closingTime > $endOfDay) continue;

			$map[] = [
				"name" => $item->playerInfo->name,
				"odds" => $offer->outcomes[0]->odds
			];
		}

		if (!isset($data_array->paging->totalPages)) {
			$output['error'] = "Missing paging info in response from page 1 of $remote_url_base";
			return $output;
		}
		$pages = $data_array->paging->totalPages;

		for ($i = 2; $i <= $pages; $i++) {
			$remote_url = $remote_url_base . $i;
			$fetched = fetchUrl($remote_url);
			if ($fetched['error'] !== null) {
				$output['error'] = $fetched['error'];
				return $output;
			}
			$json_data = $fetched['body'];

			if ($savesrc) file_put_contents($basePath . '/src_bet4_' . $i . '.json', $json_data);

			$data_array = json_decode($json_data, false);
			if (json_last_error() !== JSON_ERROR_NONE) {
				$output['error'] = "Error decoding JSON from $remote_url: " . json_last_error_msg();
				return $output;
			}

			if ($savesrc) $items[] = $data_array->items;

			foreach ($data_array->items as $item) {
				$offer = $item->betOffers[0] ?? $item;
				$closingTime = DateTime::createFromFormat('Y-m-d\TH:i:s.ue', $offer->closingTime);
				if (!$closingTime) {
					$output['error'] = "Invalid date format in response: " . $offer->closingTime;
					return $output;
				}
				if ($closingTime > $endOfDay) continue;

				$map[] = [
					"name" => $item->playerInfo->name,
					"odds" => $offer->outcomes[0]->odds
				];
			}
		}

		if ($savesrc && isset($items)) {
			$items = array_merge([], ...$items);
			$json_string = json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
			file_put_contents($basePath . '/src_bet4.json', $json_string);
		}
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
	if (file_put_contents($local_file, $json_string, LOCK_EX) === false) {
		$output['error'] = 'Error saving local JSON file: ' . $local_file;
		return $output;
	}

	$output['content'] = "{$pages} pages of data have been merged and written to {$local_file}";
	return $output;
}

/* Backup */
function backup(DateTime $now, DateTimeZone $timezone, string $basePath, array $warnings = [])
{
	$output = ['title' => null, 'content' => null, 'error' => null];

	// Backup the current data directory before fetching picks
	if (!is_dir($basePath)) {
		$output['error'] = "$basePath does not exist";
		return $output;
	}

	$local_file = $basePath . '/games.json';
	if (!file_exists($local_file)) {
		$output['error'] = "$local_file does not exist";
		return $output;
	}

	$data = file_get_contents($local_file);
	if ($data === false) {
		$output['error'] = "Error reading $local_file";
		return $output;
	}

	$data = json_decode($data, true);
	if ($data === null) {
		$output['error'] = "Error decoding JSON from $local_file";
		return $output;
	}

	$games = $data["gameWeek"][0]["games"] ?? [];

	$closestGame = null;
	$closestTime = null;
	foreach ($games as $game) {
		$gameTime = DateTime::createFromFormat('Y-m-d\TH:i:se', $game["startTimeUTC"]);

		if (!$gameTime) continue;
		if ($gameTime <= $now) continue;
		if ($closestTime === null || $gameTime < $closestTime) {
			$closestTime = clone $gameTime;
			$closestGame = $game;
		}
	}

	if ($closestGame) {
		$closestTime->setTimezone($timezone);

		$date = $now->format('Y-m-d');
		$time = $closestTime->format('Hi');

		$backupPath = $basePath . '/' . $date;
		$backupSubPath = $basePath . '/' . $date . '/' . $time;
		if (!is_dir($backupPath)) mkdir($backupPath, 0755, true);
		if (!is_dir($backupSubPath)) mkdir($backupSubPath, 0755, true);
		$bet1file = '/bet1.json';
		$bet2file = '/bet2.json';
		$bet3file = '/bet3.json';
		$bet4file = '/bet4.json';
		$gamesfile = '/games.json';
		$helperfile = '/helper.json';
		$copyErrors = [];
		if (!copy($basePath . $gamesfile, $backupPath . $gamesfile)) $copyErrors[] = $gamesfile;
		if (!copy($basePath . $bet1file, $backupSubPath . $bet1file)) $copyErrors[] = $bet1file;
		if (!copy($basePath . $bet2file, $backupSubPath . $bet2file)) $copyErrors[] = $bet2file;
		if (!copy($basePath . $bet3file, $backupSubPath . $bet3file)) $copyErrors[] = $bet3file;
		if (!copy($basePath . $bet4file, $backupSubPath . $bet4file)) $copyErrors[] = $bet4file;
		if (!copy($basePath . $helperfile, $backupSubPath . $helperfile)) $copyErrors[] = $helperfile;

		$output['title'] = "Backup";
		$output['content'] = "$backupSubPath";

		// Return without calling processed, so "started" stays behind: a lost snapshot is a failed run, and the next attempt retries on it
		if (!empty($copyErrors)) {
			$output['error'] = "Failed to copy: " . implode(", ", $copyErrors);
			return $output;
		}
	} else {
		if (empty($games)) $output['title'] = 'No games scheduled for today';
		else $output['title'] = 'No game found after the current time';
	}

	processed($now, $basePath, $warnings);

	return $output;
}

/* Mark a run as started in process.json, keeping the last complete run's time and warnings until this run finishes */
function startRun(DateTime $now, string $basePath)
{
	$local_file = $basePath . '/process.json';
	$data = file_exists($local_file) ? json_decode(file_get_contents($local_file), true) : null;
	if (!is_array($data) || !isset($data['processed'])) return;

	$data['started'] = $now->format(DateTime::ATOM);
	file_put_contents($local_file, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), LOCK_EX);
}

/*
	processed metadata object. $warnings defaults because update.php calls this from its own tree and is
	deployed separately: when this gained a required third parameter, every cron run between midnight and
	3 a.m. died on ArgumentCountError after a full scrape, and nothing advanced process.json.
*/
function processed(DateTime $now, string $basePath, array $warnings = [])
{
	// Write $now as "processed" and the run's warnings to process.json at the end of Backup, which also clears "started"
	$processObj = ["processed" => $now->format(DateTime::ATOM), "warnings" => $warnings];
	$local_file = $basePath . '/process.json';
	file_put_contents($local_file, json_encode($processObj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
}
