<?php
$live = true;
$secure = true;
$savesrc = false;
$allPlayers = false;
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

/*

   Save all players

*/
if ($allPlayers) {
	$all = [
		"ANA",
		"BOS",
		"BUF",
		"CAR",
		"CBJ",
		"CGY",
		"CHI",
		"COL",
		"DAL",
		"DET",
		"EDM",
		"FLA",
		"LAK",
		"MIN",
		"MTL",
		"NJD",
		"NSH",
		"NYI",
		"NYR",
		"OTT",
		"PHI",
		"PIT",
		"SEA",
		"SJS",
		"STL",
		"TBL",
		"TOR",
		"UTA",
		"VAN",
		"VGK",
		"WPG",
		"WSH"
	];

	foreach ($all as $code) {
		sleep(1);

		$url = 'https://api-web.nhle.com/v1/roster/' . $code . '/current';
		$response = file_get_contents($url);
		if ($response === false) {
			die('Error fetching NHL data: ' . $url);
		}

		file_put_contents('./src_games_' . $code . '.json', $response);
	}
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

	$draftkings = 'https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=42133%2C14495&eventsQuery=%24filter%3DleagueId%20eq%20%2742133%27%20AND%20clientMetadata%2FSubcategories%2Fany%28s%3A%20s%2FId%20eq%20%2714495%27%29&marketsQuery=%24filter%3DclientMetadata%2FsubCategoryId%20eq%20%2714495%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&include=Events&entity=events';
	echo "{$draftkings}<br>";

	curl_reset($ch);

	curl_setopt($ch, CURLOPT_URL, $draftkings);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

	$response = curl_exec($ch);

	if ($response === false) die();

	if ($savesrc) file_put_contents('./src_bet1.json', $response);

	$data = json_decode($response, false);
	$data = $data->selections;
	$map = [];

	foreach ($data as $selection) {
		if ($selection->outcomeType !== "ToScoreAnyTime") continue;
		$map[] = [
			"name" => $selection->participants[0]->seoIdentifier,
			"odds" => $selection->trueOdds
		];
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	$local_file = './bet1.json';
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

	if ($savesrc) file_put_contents('./src_bet2.json', $response);

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
	$local_file = './bet2.json';
	if (file_put_contents($local_file, $json_string) === false) die();

	echo "<br>Data has been written to $local_file";
}

/*

   BetMGM

*/
if ($live && isset($_GET['odds'])) {
	echo '<h2>BetMGM</h2>';

	$remote_url = 'https://www.on.betmgm.ca/cds-api/bettingoffer/fixtures?x-bwin-accessid=MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy&lang=en-us&country=CA&userCountry=CA&subdivision=CA-Ontario&fixtureTypes=Standard&state=Latest&offerMapping=Filtered&offerCategories=Gridable&fixtureCategories=Gridable,NonGridable,Other&sportIds=12&isPriceBoost=false&statisticsModes=None&skip=0&take=50&sortBy=Tags';
	echo "{$remote_url}<br>";

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
		'traceparent: 00-d7caab6056e3d8909c3e2fbe2db33320-2bb488cc751b1d29-01, 00-0000000000000000f9bc6a0f40618064-10612b6777d99058-01',
		'tracestate: dd=s:1;o:rum',
		'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
		'x-bwin-browser-url: https://www.on.betmgm.ca/en/sports/hockey-12',
		'x-correlation-id: 5d5f4241682e4bdaa9771535542cc4ed',
		'x-datadog-origin: rum',
		'x-datadog-parent-id: 1180272300740153432',
		'x-datadog-sampling-priority: 1',
		'x-datadog-trace-id: 17995374824802844772',
		'x-device-type: desktop_OS X',
		'x-from-product: host-app',
	]);
	curl_setopt($ch, CURLOPT_COOKIE, 'browserfingerprint=4I%2Fc4EAolo8Rcl4G2%2FjEhWXLYbLfHjL9kiIcv1Qopfw%3D; trc.cid=5d5f4241682e4bdaa9771535542cc4ed; lastKnownProduct=%7B%22url%22%3A%22https%3A%2F%2Fwww.on.betmgm.ca%2Fen%2Fsports%22%2C%22name%22%3A%22sports%22%2C%22previous%22%3A%22unknown%22%2C%22platformProductId%22%3A%22BETTING%22%7D; LPVID=Y5NmEwOTQ3MGM5MDljYzQz; vnCid=9d5b27ae-2c7d-4757-86af-76d37edc66e9; cjConsent=MHxZfDB8Tnww; _fbp=fb.1.1772117825739.974473780430266877; _gcl_au=1.1.1285722009.1772117827; _ga=GA1.1.1279946424.1772117827; vn_ga_client_id=1279946424.1772117827; seoLandingUrl=http%3A%2F%2Fwww.on.betmgm.ca%2Fen%2Fsports; OptanonAlertBoxClosed=2026-03-03T20:14:52.193Z; entryUrlReferrer=https%3A%2F%2Fwww.google.com%2F; entryUrl=https%3A%2F%2Fwww.on.betmgm.ca%2Fen%2Fengage%2Flan%2Fsports%2Ffirst-bet-offer%3Futm_source%3DPPC%26utm_medium%3DSports%26utm_campaign%3DTMI_BetMGM_ON_%5B_Sports_%5D_Competitors%2B%5BHybrid%5D_AIMax%26utm_term%3D21644210361_168334290842_draftking%26utm_content%3D%26wm%3D7124304%26ben%3D%26cid%3D21644210361%26cn%3DTMI_MGM_ON_GPPC_ACQ__17_GS_web_PRO_DR_NA_CPC_N_TMI-ON-MGM-Sports-Prospecting-FBO1500_SARR_1500__N%26po%3DSARR_1500_%26fec%3Don%26pc%3D17%26spc%3DGS%26pl%3DGPPC%26tc%3DACQ%26mc%3DSNBS%26at%3DTMI%26mt%3DPRO%26obj%3DDR%26tre%3DNA%26buy%3DCPC%26ska%3DN%26aw%3Dweb%26ty%3DDesktop%26la%3Den%26cre%3D%26btag%3D21644210361%26ol%3DN%26gad_source%3D1%26gad_campaignid%3D21644210361%26gbraid%3D0AAAAACyFTZZ7H3OfALqB_IlLYg329ZQcI%26gclid%3DCjwKCAiAzZ_NBhAEEiwAMtqKy0vYSDTOPJnVIGT-UMWha9lsS0FydT3pxp5yTHXeaZnPDdRiQQ4IexoChewQAvD_BwE; btag=21644210361; _gcl_gs=2.1.k1$i1772650903$u96899649; _gcl_aw=GCL.1772650907.CjwKCAiAzZ_NBhAEEiwAMtqKy0vYSDTOPJnVIGT-UMWha9lsS0FydT3pxp5yTHXeaZnPDdRiQQ4IexoChewQAvD_BwE; trackerId=7119139; c-a-v=26.11.2.15103; lang=en; vn-ld-session=-1774017180; vnSession=46f0b153-5dbc-4f32-bc42-2eb1733f5cf6; usersettings=cid%3Den-US%26vc%3D2%26sst%3D2026-03-20T14%3A33%3A43.5360463Z%26psst%3D2026-02-26T14%3A57%3A02.2226963Z; DAPROPS="bS%3A0%7CscsVersion%3A2.7.2%7Cs_uaRef%3A_uaRef2301057385%7CbcanvasNoise%3A0%7CsdeviceAspectRatio%3A16%2F9%7CsdevicePixelRatio%3A1%7Cbhtml.video.ap4x%3A0%7Cbhtml.video.av1%3A1%7Cbhtml.video.av1016M08%3A1%7Cbjs.deviceMotion%3A1%7Csjs.webGlRenderer%3AANGLE%20(Apple%2C%20ANGLE%20Metal%20Renderer%7CimaxAudioChannelCount%3A2%7CsrendererRef%3A03581227044%7CsscreenWidthHeight%3A2560%2F1440%7CishortestOpTime%3A28%7CiusableDisplayHeight%3A1319%7CiusableDisplayWidth%3A1083%7CsaudioRef%3A3239032846%7Csch.bitness%3A64%7Csch.browserFullVersionList%3A%22Chromium%22%3Bv%3D%22146.0.7680.80%22%2C%20%22Not-A.Brand%22%3Bv%3D%2224.0.0.0%22%2C%20%22Google%20Chrome%22%3Bv%3D%22146.0.7680.80%22%7Csch.browserList%3A%22Chromium%22%3Bv%3D%22146%22%2C%20%22Not-A.Brand%22%3Bv%3D%2224%22%2C%20%22Google%20Chrome%22%3Bv%3D%22146%22%7Csch.formFactors%3A%2522Desktop%2522%7Csch.model%3A%7Csch.platform%3A%22macOS%22%7Csch.platformVersion%3A%2226.3.1%22%7Csch.uaFullVersion%3A%2522146.0.7680.80%2522%7Cbch.wow64%3A0%7CbsupportsWebGpu%3A1%7CswebGpuMaxBufferSize%3A4294967296%7CsanimationFrameRate%3AStandard%7CbE%3A0"; deviceDetails=%7B%22sr%22%3A%222560%2C%201440%7C2560%2C%201440%7C24%22%2C%22sse%22%3A%221%22%2C%22lse%22%3A%221%22%2C%22idbe%22%3A%221%22%2C%22hc%22%3A%2210%22%2C%22bl%22%3A%22en-US%22%2C%22host%22%3A%22www.on.betmgm.ca%22%2C%22ua%22%3A%22Mozilla%2F5.0%20(Macintosh%3B%20Intel%20Mac%20OS%20X%2010_15_7)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F146.0.0.0%20Safari%2F537.36%22%2C%22tz%22%3A%22America%2FToronto%22%2C%22dt%22%3A%22mobileweb%22%2C%22ct%22%3A%22x32%22%2C%22dnt%22%3A%22%22%7D; tq=%5B%5D; setSessionFired=true; __cf_bm=6sgtthSdFU_Sm5JaqCQYl2sd0pJ5Wv0D6KskyAOP8T4-1774022047-1.0.1.1-AQYrVk3yfy2.8Y2UVvK7o2358vPPvlrQu7bt4vdVI2gHrxMhxwPtNgNUhxX8AC44SddAtCN0dhBWy4XYgX4KIEaEu_9OOnDhZ4A3S.wocnk; _sp_ses.0c30=*; vn_ga_session_id=1774022047; LPSID-5003492=DjRM13c9Sfmg_FUGZ7u76A; _ga_V1ZPVXDH9Y=GS2.1.s1774022047$o13$g1$t1774022428$j59$l0$h434747708; _ga_SM5BJ4XV8X=GS2.1.s1774022048$o13$g1$t1774022428$j60$l0$h0; OptanonConsent=isGpcEnabled=0&datestamp=Fri+Mar+20+2026+12%3A00%3A30+GMT-0400+(Eastern+Daylight+Time)&version=6.26.0&isIABGlobal=false&hosts=&consentId=b83ac762-44f3-47bf-8589-ff15310dd441&interactionCount=2&landingPath=NotLandingPage&groups=C0001%3A1%2CC0004%3A1%2CC0002%3A1%2CC0003%3A1&AwaitingReconsent=false&geolocation=CA%3BON; hq=%5B%7B%22name%22%3A%22homescreen%22%2C%22shouldShow%22%3Afalse%7D%5D; _uetsid=ce187390246911f1a1d38d95da8557c2; _uetvid=6a367a90132311f1a2b3adaf3378d996; _sp_id.0c30=e68baa3a-7315-40e3-9353-4ef7fb13acc3.1772117825.15.1774022439.1774018373.2083578a-1095-4c3f-aee9-878fc4de1741; _dd_s=aid=5422e4de-5491-4422-b39b-2f86bb7bf94c&rum=2&id=b13ac10c-c5f2-40dc-b516-c52a01101c28&created=1774017224355&expire=1774023339616');

	$response = curl_exec($ch);
	if ($response === false) {
		if ($debug) die('cURL Error: ' . curl_error($ch));
		else die();
	}

	if ($savesrc) file_put_contents('./src_bet3_0.json', $response);
	$json_data = json_decode($response, false);
	if (json_last_error() !== JSON_ERROR_NONE) {
		if ($debug) die('Error decoding JSON: ' . json_last_error_msg());
		else die();
	}

	$ids = [];
	foreach ($json_data->fixtures as $fixture) {
		if ($fixture->competition->name->value !== 'NHL') continue;

		$closingTime = DateTime::createFromFormat('Y-m-d\TH:i:se', $fixture->startDate);
		$closingTime = $closingTime->getTimestamp();
		if ($closingTime > $endOfDay) continue;

		$ids[] = $fixture->id;
	}
	echo "<br>" . count($ids) . " games<br>";

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
			'traceparent: 00-dd55c6b6ad9aca19a6e94f99753d7562-677205be5f493bd0-01, 00-000000000000000078c6a125cd306b8e-7e275f02852e4aba-01',
			'tracestate: dd=s:1;o:rum',
			'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
			'x-bwin-browser-url: https://www.on.betmgm.ca/en/sports/events/carolina-hurricanes-at-toronto-maple-leafs-19046169?tab=score',
			'x-correlation-id: 5d5f4241682e4bdaa9771535542cc4ed',
			'x-datadog-origin: rum',
			'x-datadog-parent-id: 9090338837299612346',
			'x-datadog-sampling-priority: 1',
			'x-datadog-trace-id: 8702820513668426638',
			'x-device-type: desktop_OS X',
			'x-from-product: host-app',
		]);
		curl_setopt($ch, CURLOPT_COOKIE, 'browserfingerprint=4I%2Fc4EAolo8Rcl4G2%2FjEhWXLYbLfHjL9kiIcv1Qopfw%3D; trc.cid=5d5f4241682e4bdaa9771535542cc4ed; lastKnownProduct=%7B%22url%22%3A%22https%3A%2F%2Fwww.on.betmgm.ca%2Fen%2Fsports%22%2C%22name%22%3A%22sports%22%2C%22previous%22%3A%22unknown%22%2C%22platformProductId%22%3A%22BETTING%22%7D; LPVID=Y5NmEwOTQ3MGM5MDljYzQz; vnCid=9d5b27ae-2c7d-4757-86af-76d37edc66e9; cjConsent=MHxZfDB8Tnww; _fbp=fb.1.1772117825739.974473780430266877; _gcl_au=1.1.1285722009.1772117827; _ga=GA1.1.1279946424.1772117827; vn_ga_client_id=1279946424.1772117827; seoLandingUrl=http%3A%2F%2Fwww.on.betmgm.ca%2Fen%2Fsports; OptanonAlertBoxClosed=2026-03-03T20:14:52.193Z; entryUrlReferrer=https%3A%2F%2Fwww.google.com%2F; entryUrl=https%3A%2F%2Fwww.on.betmgm.ca%2Fen%2Fengage%2Flan%2Fsports%2Ffirst-bet-offer%3Futm_source%3DPPC%26utm_medium%3DSports%26utm_campaign%3DTMI_BetMGM_ON_%5B_Sports_%5D_Competitors%2B%5BHybrid%5D_AIMax%26utm_term%3D21644210361_168334290842_draftking%26utm_content%3D%26wm%3D7124304%26ben%3D%26cid%3D21644210361%26cn%3DTMI_MGM_ON_GPPC_ACQ__17_GS_web_PRO_DR_NA_CPC_N_TMI-ON-MGM-Sports-Prospecting-FBO1500_SARR_1500__N%26po%3DSARR_1500_%26fec%3Don%26pc%3D17%26spc%3DGS%26pl%3DGPPC%26tc%3DACQ%26mc%3DSNBS%26at%3DTMI%26mt%3DPRO%26obj%3DDR%26tre%3DNA%26buy%3DCPC%26ska%3DN%26aw%3Dweb%26ty%3DDesktop%26la%3Den%26cre%3D%26btag%3D21644210361%26ol%3DN%26gad_source%3D1%26gad_campaignid%3D21644210361%26gbraid%3D0AAAAACyFTZZ7H3OfALqB_IlLYg329ZQcI%26gclid%3DCjwKCAiAzZ_NBhAEEiwAMtqKy0vYSDTOPJnVIGT-UMWha9lsS0FydT3pxp5yTHXeaZnPDdRiQQ4IexoChewQAvD_BwE; btag=21644210361; _gcl_gs=2.1.k1$i1772650903$u96899649; _gcl_aw=GCL.1772650907.CjwKCAiAzZ_NBhAEEiwAMtqKy0vYSDTOPJnVIGT-UMWha9lsS0FydT3pxp5yTHXeaZnPDdRiQQ4IexoChewQAvD_BwE; trackerId=7119139; c-a-v=26.11.2.15103; lang=en; vn-ld-session=-1774017180; vnSession=46f0b153-5dbc-4f32-bc42-2eb1733f5cf6; usersettings=cid%3Den-US%26vc%3D2%26sst%3D2026-03-20T14%3A33%3A43.5360463Z%26psst%3D2026-02-26T14%3A57%3A02.2226963Z; DAPROPS="bS%3A0%7CscsVersion%3A2.7.2%7Cs_uaRef%3A_uaRef2301057385%7CbcanvasNoise%3A0%7CsdeviceAspectRatio%3A16%2F9%7CsdevicePixelRatio%3A1%7Cbhtml.video.ap4x%3A0%7Cbhtml.video.av1%3A1%7Cbhtml.video.av1016M08%3A1%7Cbjs.deviceMotion%3A1%7Csjs.webGlRenderer%3AANGLE%20(Apple%2C%20ANGLE%20Metal%20Renderer%7CimaxAudioChannelCount%3A2%7CsrendererRef%3A03581227044%7CsscreenWidthHeight%3A2560%2F1440%7CishortestOpTime%3A28%7CiusableDisplayHeight%3A1319%7CiusableDisplayWidth%3A1083%7CsaudioRef%3A3239032846%7Csch.bitness%3A64%7Csch.browserFullVersionList%3A%22Chromium%22%3Bv%3D%22146.0.7680.80%22%2C%20%22Not-A.Brand%22%3Bv%3D%2224.0.0.0%22%2C%20%22Google%20Chrome%22%3Bv%3D%22146.0.7680.80%22%7Csch.browserList%3A%22Chromium%22%3Bv%3D%22146%22%2C%20%22Not-A.Brand%22%3Bv%3D%2224%22%2C%20%22Google%20Chrome%22%3Bv%3D%22146%22%7Csch.formFactors%3A%2522Desktop%2522%7Csch.model%3A%7Csch.platform%3A%22macOS%22%7Csch.platformVersion%3A%2226.3.1%22%7Csch.uaFullVersion%3A%2522146.0.7680.80%2522%7Cbch.wow64%3A0%7CbsupportsWebGpu%3A1%7CswebGpuMaxBufferSize%3A4294967296%7CsanimationFrameRate%3AStandard%7CbE%3A0"; deviceDetails=%7B%22sr%22%3A%222560%2C%201440%7C2560%2C%201440%7C24%22%2C%22sse%22%3A%221%22%2C%22lse%22%3A%221%22%2C%22idbe%22%3A%221%22%2C%22hc%22%3A%2210%22%2C%22bl%22%3A%22en-US%22%2C%22host%22%3A%22www.on.betmgm.ca%22%2C%22ua%22%3A%22Mozilla%2F5.0%20(Macintosh%3B%20Intel%20Mac%20OS%20X%2010_15_7)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F146.0.0.0%20Safari%2F537.36%22%2C%22tz%22%3A%22America%2FToronto%22%2C%22dt%22%3A%22mobileweb%22%2C%22ct%22%3A%22x32%22%2C%22dnt%22%3A%22%22%7D; tq=%5B%5D; setSessionFired=true; vn_ga_session_id=1774022047; LPSID-5003492=DjRM13c9Sfmg_FUGZ7u76A; OptanonConsent=isGpcEnabled=0&datestamp=Fri+Mar+20+2026+12%3A00%3A44+GMT-0400+(Eastern+Daylight+Time)&version=6.26.0&isIABGlobal=false&hosts=&consentId=b83ac762-44f3-47bf-8589-ff15310dd441&interactionCount=2&landingPath=NotLandingPage&groups=C0001%3A1%2CC0004%3A1%2CC0002%3A1%2CC0003%3A1&AwaitingReconsent=false&geolocation=CA%3BON; hq=%5B%7B%22name%22%3A%22homescreen%22%2C%22shouldShow%22%3Afalse%7D%5D; __cf_bm=X.whm_8EZvpX_rPl3z8eNSG7wy.X4aeOblOoLiLoOtQ-1774028987-1.0.1.1-Wlr.9cy2CLGX6z_fnrIXvXOc2XLuCVn2XehUeT9BOuG5w0kK9ATbuahSQB3Zfhn1lbyaY2ofvnjpuQr6Ps6ibHKHuqI3NIab9qkzUuCBAaI; _sp_ses.0c30=*; _uetsid=ce187390246911f1a1d38d95da8557c2; _uetvid=6a367a90132311f1a2b3adaf3378d996; _sp_id.0c30=e68baa3a-7315-40e3-9353-4ef7fb13acc3.1772117825.16.1774029582.1774022696.9e7211f6-eb36-47b9-a9d6-3bf7a2da37f2; _ga_V1ZPVXDH9Y=GS2.1.s1774029578$o14$g1$t1774029582$j56$l0$h183996719; _ga_SM5BJ4XV8X=GS2.1.s1774029579$o14$g1$t1774029582$j57$l0$h0; _dd_s=aid=5422e4de-5491-4422-b39b-2f86bb7bf94c&rum=2&id=ab22c692-071b-4736-8de3-626a99f0b1e0&created=1774028510405&expire=1774030493028');

		$response = curl_exec($ch);
		if ($response === false) {
			if ($debug) die('cURL Error: ' . curl_error($ch));
			else die();
		}

		if ($savesrc) file_put_contents('./src_bet3_' . $id . '.json', $response);

		$json_data = json_decode($response, false);
		if (json_last_error() !== JSON_ERROR_NONE) {
			if ($debug) die('Error decoding JSON: ' . json_last_error_msg());
			else die();
		}

		foreach ($json_data->fixture->games as $game) {
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
	}

	if ($savesrc) {
		$items = array_merge([], ...$items);
		$json_string = json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
		file_put_contents('./src_bet3.json', $json_string, LOCK_EX);
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	$local_file = './bet3.json';

	if (file_put_contents($local_file, $json_string, LOCK_EX) === false) die();

	echo "<br>Data has been merged and written to $local_file";
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

	if ($savesrc) file_put_contents('./src_bet4_1.json', $json_data);

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

		if ($savesrc) file_put_contents('./src_bet4_' . $i . '.json', $json_data);

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
		file_put_contents('./src_bet4.json', $json_string, LOCK_EX);
	}

	$json_string = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	$local_file = './bet4.json';

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

	if ($savesrc) file_put_contents('./src_bet5v5.json', $data);

	$start = strpos($data, 'const table_1_data');
	if ($start === false) die();

	$end = strpos($data, 'gridTimsPicks(');
	if ($end === false) die();

	$data = substr($data, $start, $end - $start);

	$data = str_replace('const table_1_data = ', 'export const table_1_data = ', $data);
	$data = str_replace('const table_2_data = ', 'export const table_2_data = ', $data);
	$data = str_replace('const table_3_data = ', 'export const table_3_data = ', $data);

	$local_file = './bet5v5.ts';
	if (file_put_contents($local_file, $data, LOCK_EX) === false) die();

	echo "<br>Data has been written to $local_file";
}
