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
	return curlResult($ch, curl_exec($ch), $url);
}

/* The checks above, for a response a handle has already fetched, alone or alongside others */
function curlResult(CurlHandle $ch, string|false $response, string $url)
{
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
	'Viggo Bjorck' => 8486025, // The pick-list feed sends id 0
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

/*
	A book that fails, by an error or by throwing, doesn't stop the run, and the failure becomes a warning,
	which the site's banner lists. The warning names the book as the page does, without the addresses the
	error held, since visitors read it. Prices it wrote earlier today are left in place, so the page keeps
	showing them. A file from an earlier day holds another day's games, so it is emptied instead, and the
	snapshot then keeps the slot's earlier copy (keepsEarlierPrices). Only a file that can't be written stays
	an error.
*/
function withoutFailedBook(string $title, string $local_file, callable $fetch)
{
	try {
		$output = $fetch();
	} catch (Throwable $e) {
		$output = ['title' => $title, 'content' => null, 'error' => get_class($e) . ': ' . $e->getMessage()];
	}
	if ($output['error'] === null) return $output;

	$reason = withoutAddresses($output['error'], $title);
	$earlier = earlierPricesToday($local_file);
	if ($earlier !== null) {
		$output['warning'][] = "$title: kept odds from $earlier: $reason";
		$output['content'] = "Kept odds from $earlier";
		$output['error'] = null;
		return $output;
	}

	if (file_put_contents($local_file, '[]', LOCK_EX) === false) {
		$output['error'] = 'Error saving local JSON file: ' . $local_file;
		return $output;
	}
	$output['warning'][] = "$title: no odds recorded: $reason";
	$output['content'] = 'No odds recorded';
	$output['error'] = null;
	return $output;
}

/* An error without its addresses: "from <url>" and the like are dropped, and any other URL or host name, such as
   one in a cURL message, becomes the book's name. A server path, as a thrown error gives it, keeps only its file
   name, and a file name keeps its extension, which isn't a host */
function withoutAddresses(string $error, string $title)
{
	$url = 'https?://\S*?(?=:?\s|:?$)';
	$name = str_replace(['\\', '$'], ['\\\\', '\\$'], $title);
	$error = preg_replace("#\s+(?:from|of|on)\s+$url#", '', $error);
	$error = preg_replace("#$url#", $name, $error);
	$error = preg_replace('#(?<![\w.])/(?:[^\s/:]+/)+([^\s/:]+)#', '$1', $error);
	return preg_replace('#\b(?:[a-z0-9-]+\.)+(?!(?:php|json|html?|m?js)\b)[a-z]{2,}\b#i', $name, $error);
}

// The time a book file was written, when that was today (ET) and it holds prices; null otherwise
function earlierPricesToday(string $local_file)
{
	clearstatcache(true, $local_file);
	$mtime = @filemtime($local_file);
	if ($mtime === false) return null;

	$timezone = new DateTimeZone('America/New_York');
	if ($mtime < (new DateTime('today midnight', $timezone))->getTimestamp()) return null;

	$prices = json_decode((string)file_get_contents($local_file), true);
	if (!is_array($prices) || count($prices) === 0) return null;

	return (new DateTime('@' . $mtime))->setTimezone($timezone)->format('g:i A');
}

/*
	The master list of books, sportsbooks.json beside this file, in display order. Each book's mode says where
	its prices come from: direct reads the book's own site, comparison reads the book's prices off an
	odds-comparison page in the book's region, and off leaves the book alone, so it isn't fetched, its file
	isn't touched or copied into snapshots, and the page doesn't show it. The front end is built from the
	same file, so turning a book off or on also takes a build.
*/
const BOOK_MODES = ['direct', 'comparison', 'off'];

/* The books with a fetcher for their own site. A book without one can only run in comparison mode. The fetchers
   share one signature, since they're called through this table, and each ignores what its site doesn't need */
const DIRECT_FETCHERS = ['bet1' => 'fetchBet1', 'bet2' => 'fetchBet2', 'bet3' => 'fetchBet3', 'bet4' => 'fetchBet4'];

function sportsbooks()
{
	$local_file = __DIR__ . '/sportsbooks.json';
	$data = @file_get_contents($local_file);
	if ($data === false) return ['books' => null, 'error' => "Error reading the book list $local_file"];

	$books = json_decode($data, true);
	if (!is_array($books) || !array_is_list($books)) return ['books' => null, 'error' => "The book list $local_file isn't a JSON list"];

	$keys = [];
	foreach ($books as $index => $book) {
		$key = is_array($book) ? ($book['key'] ?? null) : null;
		$where = "Book " . ($index + 1) . " in $local_file";
		if (!is_string($key) || !preg_match('/^bet\d+$/', $key)) return ['books' => null, 'error' => "$where has no key of the form bet<n>"];
		if (isset($keys[$key])) return ['books' => null, 'error' => "$where repeats the key $key"];
		$keys[$key] = true;
		if (!is_string($book['title'] ?? null) || trim($book['title']) === '') return ['books' => null, 'error' => "$where ($key) has no title"];
		if (!in_array($book['mode'] ?? null, BOOK_MODES, true)) return ['books' => null, 'error' => "$where ($key) has a mode other than " . implode(', ', BOOK_MODES)];
		if ($book['mode'] !== 'comparison') continue;
		$slug = $book['comparison']['slug'] ?? null;
		$region = $book['comparison']['region'] ?? null;
		if (!is_string($slug) || !preg_match('/^[a-z0-9-]+$/', $slug) || !is_string($region) || !preg_match('/^[A-Z]{2}-[A-Z]{2}$/', $region)) {
			return ['books' => null, 'error' => "$where ($key) runs in comparison mode without a comparison slug and region"];
		}
	}
	return ['books' => $books, 'error' => null];
}

/*
	Every book the list doesn't turn off, in its order, one step output each. A book that fails is a warning
	(withoutFailedBook), so only an unreadable list, or a file that can't be written, stops the run. The
	comparison books share one pass over the comparison pages. $books stands in for the list, for a check
	that pulls the books through other modes.
*/
function updateBooks(DateTime $now, DateTime $endOfDay, CurlHandle $ch, string $basePath, bool $savesrc = false, ?array $books = null)
{
	if ($books === null) {
		$list = sportsbooks();
		if ($list['error'] !== null) return [['title' => 'Sportsbooks', 'content' => null, 'error' => $list['error']]];
		$books = $list['books'];
	}
	$active = array_values(array_filter($books, fn($book) => $book['mode'] !== 'off'));

	$compared = array_values(array_filter($active, fn($book) => $book['mode'] === 'comparison'));
	try {
		$comparison = $compared ? fetchComparison($now, $compared, $basePath, $savesrc) : [];
	} catch (Throwable $e) {
		$failed = ['title' => null, 'content' => null, 'error' => get_class($e) . ': ' . $e->getMessage()];
		$comparison = array_fill_keys(array_column($compared, 'key'), $failed);
	}

	$outputs = [];
	foreach ($active as $book) {
		$key = $book['key'];
		$fetch = $book['mode'] === 'comparison'
			? fn() => $comparison[$key]
			: function () use ($key, $endOfDay, $ch, $basePath, $savesrc) {
				$fetcher = DIRECT_FETCHERS[$key] ?? null;
				if ($fetcher === null) return ['title' => null, 'content' => null, 'error' => "$key has no fetcher for its own site, so it can only run in comparison mode"];
				return $fetcher($endOfDay, $ch, $basePath, $savesrc);
			};
		$output = withoutFailedBook($book['title'], "$basePath/$key.json", $fetch);
		$output['title'] = $book['title'];
		$outputs[] = $output;
	}
	return $outputs;
}

/* DraftKings */
function fetchBet1(DateTime $endOfDay, CurlHandle $ch, string $basePath, bool $savesrc = false)
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
function fetchBet2(DateTime $endOfDay, CurlHandle $ch, string $basePath, bool $savesrc = false)
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
				// Skip a runner listed without a price: dividing by its missing denominator stops the whole run
				if (empty($runner->winRunnerOdds->trueOdds->fractionalOdds->denominator)) continue;
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
function fetchBet3(DateTime $endOfDay, CurlHandle $ch, string $basePath, bool $savesrc = false)
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

		// From 2026-10-12 each player has a market of their own, "<Player> to Score 1 or more Goals", priced on its Yes option
		foreach ($json_data->fixture->optionMarkets ?? [] as $market) {
			if (!preg_match('/^(.+) to Score 1 or more Goals$/', $market->name->value, $match)) continue;

			if ($savesrc) $items[] = [$market];

			foreach ($market->options as $option) {
				if ($option->name->value !== 'Yes' || !isset($option->price->odds)) continue;
				$map[] = [
					"name" => $match[1],
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
function fetchBet4(DateTime $endOfDay, CurlHandle $ch, string $basePath, bool $savesrc = false)
{
	$output = ['title' => null, 'content' => null, 'error' => null];
	$output['title'] = 'BetRivers';

	$remote_url_base = 'https://on.betrivers.ca/api/service/sportsbook/offering/propcentral/offers?groupId=1000093657&marketCategory=TO_SCORE&pageSize=20&cageCode=249&t=' . time() . '&pageNr=';
	$local_file = $basePath . '/bet4.json';

	$remote_url = $remote_url_base . '1';

	$fetched = fetchUrl($remote_url);
	if ($fetched['error'] !== null) {
		$output['error'] = $fetched['error'];
		return $output;
	}
	$json_data = $fetched['body'];

	$map = [];
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

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
	if (file_put_contents($local_file, $json_string, LOCK_EX) === false) {
		$output['error'] = 'Error saving local JSON file: ' . $local_file;
		return $output;
	}

	$output['content'] = "{$pages} pages of data have been merged and written to {$local_file}";
	return $output;
}

/* The odds-comparison pages: a day's matchups, and a game's odds tab for a region such as CA-ON */
const COMPARISON_MATCHUPS = 'https://www.covers.com/sports/nhl/matchups?selectedDate=';
const COMPARISON_TAB = 'https://www.covers.com/sport/hockey/nhl/matchup/%s/tab/odds?countryCode=%s&stateProv=%s';

/* A comparison page's request. The odds tab answers the page's own request for it with the tab alone */
function comparisonOptions(bool $tab)
{
	$headers = [
		'accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'accept-language: en-US,en;q=0.9',
		'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
	];
	if ($tab) $headers[] = 'x-requested-with: XMLHttpRequest';
	return [
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_FOLLOWLOCATION => true,
		CURLOPT_ENCODING => '',
		CURLOPT_CONNECTTIMEOUT => 5,
		CURLOPT_TIMEOUT => 20,
		CURLOPT_HTTPHEADER => $headers,
	];
}

/*
	The comparison books' prices for today's games that haven't started. The matchups page names the games,
	and each game's odds tab lists every book in its region with each player's anytime goal scorer price, so
	a tab is fetched once per game and region, whichever books share it. A started game's tab would hold
	live prices, and the books take a game's player markets down at puck drop anyway. One output per book,
	by key: a page that fails fails every book that needed it.
*/
function fetchComparison(DateTime $now, array $books, string $basePath, bool $savesrc = false)
{
	$outputs = [];
	$fail = function (array $keys, string $error) use (&$outputs) {
		foreach ($keys as $key) $outputs[$key] = ['title' => null, 'content' => null, 'error' => $error];
	};

	$url = COMPARISON_MATCHUPS . $now->format('Y-m-d');
	$ch = curl_init($url);
	curl_setopt_array($ch, comparisonOptions(false));
	$fetched = fetchCurl($ch, $url);
	if ($fetched['error'] !== null) {
		$fail(array_column($books, 'key'), $fetched['error']);
		return $outputs;
	}
	if ($savesrc) file_put_contents($basePath . '/src_comparison.html', $fetched['body']);

	/* For a day without games the page shows the nearest day that has some, so its games count only when it shows
	   today. Without today's games, it's a quiet day only when the schedule agrees; otherwise the layout may have changed */
	$today = $now->format('M d');
	$shown = comparisonDate($fetched['body']);
	$games = $shown === $today ? comparisonGames($fetched['body']) : [];
	if (!$games && scheduledGames($now, $basePath) !== 0) {
		$error = $shown === null ? 'The comparison matchups page names no date'
			: ($shown === $today ? "The comparison matchups page lists none of today's games" : "The comparison matchups page shows $shown, not today");
		$fail(array_column($books, 'key'), $error);
		return $outputs;
	}
	$upcoming = array_keys(array_filter($games));

	$byRegion = [];
	foreach ($books as $book) $byRegion[$book['comparison']['region']][] = $book;

	foreach ($byRegion as $region => $regionBooks) {
		[$country, $state] = explode('-', $region);
		$urls = [];
		foreach ($upcoming as $id) $urls[$id] = sprintf(COMPARISON_TAB, $id, $country, $state);

		$slugs = array_column(array_column($regionBooks, 'comparison'), 'slug');
		$prices = array_fill_keys($slugs, []);
		$error = null;
		foreach (fetchParallel($urls, comparisonOptions(true)) as $id => $page) {
			if ($page['error'] !== null) {
				$error = $page['error'];
				break;
			}
			if ($savesrc) file_put_contents("$basePath/src_comparison_{$region}_$id.html", $page['body']);
			foreach (comparisonPrices($page['body'], $slugs) as $slug => $entries) array_push($prices[$slug], ...$entries);
		}
		if ($error !== null) {
			$fail(array_column($regionBooks, 'key'), $error);
			continue;
		}

		foreach ($regionBooks as $book) {
			$local_file = "$basePath/{$book['key']}.json";
			$json_string = json_encode($prices[$book['comparison']['slug']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
			if (file_put_contents($local_file, $json_string, LOCK_EX) === false) {
				$outputs[$book['key']] = ['title' => null, 'content' => null, 'error' => 'Error saving local JSON file: ' . $local_file];
				continue;
			}
			$outputs[$book['key']] = ['title' => null, 'content' => count($upcoming) . " games of data have been merged and written to $local_file", 'error' => null];
		}
	}
	return $outputs;
}

/* Several pages at once, at most $limit in flight, each through fetchCurl's checks, returned by the key each URL came under */
function fetchParallel(array $urls, array $options, int $limit = 4)
{
	$results = array_fill_keys(array_keys($urls), null);
	$waiting = $urls;
	$running = [];
	$multi = curl_multi_init();
	while ($waiting || $running) {
		while ($waiting && count($running) < $limit) {
			$key = array_key_first($waiting);
			$ch = curl_init($waiting[$key]);
			curl_setopt_array($ch, $options);
			curl_multi_add_handle($multi, $ch);
			$running[spl_object_id($ch)] = [$key, $ch];
			unset($waiting[$key]);
		}
		curl_multi_exec($multi, $active);
		if ($active) curl_multi_select($multi, 1.0);
		while ($done = curl_multi_info_read($multi)) {
			[$key, $ch] = $running[spl_object_id($done['handle'])];
			$response = $done['result'] === CURLE_OK ? curl_multi_getcontent($ch) : false;
			$results[$key] = curlResult($ch, $response ?? false, $urls[$key]);
			curl_multi_remove_handle($multi, $ch);
			unset($running[spl_object_id($ch)]);
		}
	}
	curl_multi_close($multi);
	return $results;
}

/* How many games today's schedule, as this run wrote it, lists for today; null when it can't be read */
function scheduledGames(DateTime $now, string $basePath)
{
	$data = json_decode((string)@file_get_contents($basePath . '/games.json'), true);
	$week = $data['gameWeek'][0] ?? null;
	if (!is_array($week) || ($week['date'] ?? null) !== $now->format('Y-m-d')) return null;
	return count($week['games'] ?? []);
}

/* The day a matchups page shows, as its date bar marks it, such as "Nov 01"; null when the bar can't be read */
function comparisonDate(string $page)
{
	if (!preg_match('#aria-current="page" aria-label="\w+ &middot; (\w+ \d+)"#', $page, $match)) return null;
	return $match[1];
}

/* The games on a matchups page, by id: true for a game that hasn't started */
function comparisonGames(string $page)
{
	preg_match_all('#<article id="nhl-(\d+)" class="gamebox (\w+)#', $page, $matches, PREG_SET_ORDER);
	$games = [];
	foreach ($matches as [, $id, $state]) $games[$id] = $state === 'pregamebox';
	return $games;
}

/*
	Each book's anytime goal scorer prices on a game's odds tab, by slug. The Goals Scored section holds a
	block per player, and a book's price is its over on 0.5 goals. A book can appear twice in a block, since
	the best price is repeated above the full list, so only its first appears.
*/
function comparisonPrices(string $page, array $slugs)
{
	$prices = array_fill_keys($slugs, []);
	$start = strpos($page, '>Goals Scored</h2>');
	if ($start === false) return $prices;
	$end = strpos($page, '</article>', $start);
	$section = $end === false ? substr($page, $start) : substr($page, $start, $end - $start);

	foreach (array_slice(preg_split('#<a href="[^"]*/sport/hockey/nhl/players/#', $section), 1) as $block) {
		if (!preg_match('#<span class="category fw-bold text-nowrap">\s*([^<]+?)\s*</span>#', $block, $match)) continue;
		$name = html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');

		preg_match_all('#slug=([a-z0-9-]+)[^>]*>\s*<span class="oddsSideLineText">o0\.5</span>\s*<span class="oddsSideOddsText[^"]*">([^<]+)<#', $block, $offers, PREG_SET_ORDER);
		$seen = [];
		foreach ($offers as [, $slug, $american]) {
			if (!isset($prices[$slug]) || isset($seen[$slug])) continue;
			$seen[$slug] = true;
			$odds = americanToDecimal(html_entity_decode($american, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
			if ($odds !== null) $prices[$slug][] = ["name" => $name, "odds" => $odds];
		}
	}
	return $prices;
}

/* American odds as decimal odds to four places, or null for text that isn't a price */
function americanToDecimal(string $american)
{
	$american = str_replace(["\u{2212}", "\u{2013}"], '-', trim($american));
	if (strcasecmp($american, 'even') === 0 || strcasecmp($american, 'ev') === 0) return 2.0;
	if (!preg_match('/^[+-]?\d+$/', $american)) return null;

	$value = (int)$american;
	if (abs($value) < 100) return null;
	return round($value > 0 ? 1 + $value / 100 : 1 + 100 / -$value, 4);
}

/* True when a book came back empty and the snapshot already holds its prices from an earlier run.
   A feed that drops its market partway through the day would otherwise wipe the last prices the
   slot captured; the kept file's older time stamp is the trace */
function keepsEarlierPrices(string $source, string $target)
{
	if (!file_exists($source) || !file_exists($target)) return false;
	if (json_decode((string)file_get_contents($source), true) !== []) return false;

	$earlier = json_decode((string)file_get_contents($target), true);
	return is_array($earlier) && count($earlier) > 0;
}

/* A copy with its source's modified time, so a book file kept from an earlier run shows in the snapshot when its prices are from */
function copyKeepingTime(string $source, string $target)
{
	if (!copy($source, $target)) return false;
	clearstatcache(true, $source);
	$mtime = filemtime($source);
	return $mtime === false || touch($target, $mtime);
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

	$list = sportsbooks();
	if ($list['error'] !== null) {
		$output['error'] = $list['error'];
		return $output;
	}

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
		$gamesfile = '/games.json';
		$helperfile = '/helper.json';
		$copyErrors = [];
		if (!copy($basePath . $gamesfile, $backupPath . $gamesfile)) $copyErrors[] = $gamesfile;
		foreach ($list['books'] as $book) {
			if ($book['mode'] === 'off') continue;
			$betfile = "/{$book['key']}.json";
			if (keepsEarlierPrices($basePath . $betfile, $backupSubPath . $betfile)) continue;
			if (!copyKeepingTime($basePath . $betfile, $backupSubPath . $betfile)) $copyErrors[] = $betfile;
		}
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

	// A "started" still here is an attempt that never finished. Each attempt restamps "started", which the cron's
	// retry wait measures from, so "failingSince" keeps the first attempt of the unbroken failures for the banner
	if (isset($data['started'])) $data['failingSince'] = $data['failingSince'] ?? $data['started'];
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
