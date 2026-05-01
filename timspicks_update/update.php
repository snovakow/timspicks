<?php
/*
1. Enter crontab edit mode: crontab -e
2. Enter insert mode: i
3. Type command: * * * * * curl "https://snovakow.sensitive/update.php?lib=public" >> timspicks_log.txt
4. Save the file: Esc, :w, Enter
5. Quit vim: :q
6. List your cron jobs: crontab -l

Delete all crontabs: crontab -r
*/

$codeRoot = isset($_GET['lib']) ? $_GET['lib'] : 'public';
require_once "../{$codeRoot}/fetch_lib.php";

function process(string $basePath)
{
    $local_file = $basePath . '/process.json';
    if (!file_exists($local_file)) return null;

    $data = file_get_contents($local_file);
    if ($data === false) return null;

    $data = json_decode($data, false);
    if ($data === null) return null;

    $data = $data->processed;
    if (!isset($data)) return null;

    $date = new DateTime($data);
    if ($date === false) return null;

    return $date;
}

function processGames(DateTime $now, string $basePath)
{
    $local_file = $basePath . '/games.json';
    if (!file_exists($local_file)) return null;

    $data = file_get_contents($local_file);
    if ($data === false) return null;

    $data = json_decode($data, true);
    if ($data === null) return null;

    $data = $data["gameWeek"];
    if (!isset($data)) return null;

    $data = $data[0];
    if (!isset($data)) return null;

    if (!isset($data["date"])) return null;

    $date = DateTime::createFromFormat('Y-m-d', $data["date"]);
    if ($date === false) return null;

    if ($date->format('Y-m-d') !== $now->format('Y-m-d')) return null;

    $games = $data["games"];
    if (!isset($games)) return null;

    $gameTimes = [];

    foreach ($games as $game) {
        $gameTime = $game["startTimeUTC"];
        if (!isset($gameTime)) continue;

        $gameTime = DateTime::createFromFormat('Y-m-d\TH:i:se', $gameTime);
        if ($gameTime === false) continue;

        $gameTimes[] = $gameTime;
    }

    // Sort gameTimes from earliest to latest
    usort($gameTimes, function ($a, $b) {
        return $a <=> $b;
    });

    return $gameTimes;
}

function logOutput(array $output)
{
    if (isset($output['title'])) echo "{$output['title']}";
    if (isset($output['content'])) echo ": {$output['content']}";
    echo "\n";
}

function logEnd(DateTime $now, string $message)
{
    die('*** ' . $now->format('Y-m-d h:i A') . ": {$message}\n");
}

$basePath = "../{$codeRoot}/data";
if (!is_dir($basePath)) mkdir($basePath, 0755, true);

$timezone = new DateTimeZone('America/New_York');
$now = new DateTime('now', $timezone);

$minOutput = true;

/*
    a. Don't update between the last game and midnight.
    b. Update $updatePeriod since the previous update, unless a game start time has passed.
    c. Don't update within $updateBuffer seconds from a game start time or midnight.
*/
$updatePeriod = 60 * 60;
$updateBuffer = 1 * 60;

$processDate = process($basePath);
$gameTimes = processGames($now, $basePath);
if ($processDate !== null && $gameTimes !== null) {
    if (count($gameTimes) === 0) {
        if ($minOutput) die();
        logEnd($now, "No games found");
    }

    $nowTime = $now->getTimestamp();

    // a. Don't update between the last game and midnight
    $lastGameTime = end($gameTimes)->getTimestamp();
    $midnightTime = (new DateTime('tomorrow midnight', $timezone))->getTimestamp();
    if ($nowTime >= $lastGameTime - $updateBuffer && $nowTime <= $midnightTime + $updateBuffer) {
        if ($minOutput) die();
        logEnd($now, "Not updating between last game and midnight");
    }

    $processTime = $processDate->getTimestamp();

    $gamePassedSinceLastUpdate = false;
    foreach ($gameTimes as $gameDate) {
        $gameTime = $gameDate->getTimestamp();

        // Check if within update buffer
        $diff = $gameTime - $nowTime;
        if ($diff >= -$updateBuffer && $diff <= $updateBuffer) {
            // c. Don't update within $updateBuffer seconds from a game start time
            if ($minOutput) die();
            logEnd($now, "Not updating near game start time");
        }
        // Check if a game has passed since last update
        if ($gameTime >= $processTime && $gameTime <= $nowTime) {
            $gamePassedSinceLastUpdate = true;
        }
    }

    // b. Only update if $updatePeriod has passed since last update, unless a game start time has passed since previous update
    $timeSinceProcess = $nowTime - $processDate->getTimestamp();
    if (!$gamePassedSinceLastUpdate && $timeSinceProcess < $updatePeriod) {
        if ($minOutput) die();
        logEnd($now, "Not updating");
    }
}

if (!$minOutput) echo "Data Downloader\n";

/* Games */
$output = updateGames($now, $basePath);
if (!$minOutput) logOutput($output);
if (isset($output['error'])) logEnd($now, "{$output['error']}");

$ch = curl_init();

/* Picks */
$output = updatePicks($ch, $basePath);
if (!$minOutput) logOutput($output);
if (isset($output['error'])) logEnd($now, "{$output['error']}");

/* DraftKings */
$output = updateBet1($ch, $basePath);
if (!$minOutput) logOutput($output);
if (isset($output['error'])) logEnd($now, "{$output['error']}");

$endOfDay = new DateTime('tomorrow midnight', $timezone);

/* FanDuel */
$output = updateBet2($endOfDay, $ch, $basePath);
if (!$minOutput) logOutput($output);
if (isset($output['error'])) logEnd($now, "{$output['error']}");

/* BetMGM */
$output = updateBet3($endOfDay, $ch, $basePath);
if (!$minOutput) logOutput($output);
if (isset($output['error'])) logEnd($now, "{$output['error']}");

/* BetRivers */
$output = updateBet4($endOfDay, $basePath);
if (!$minOutput) logOutput($output);
if (isset($output['error'])) logEnd($now, "{$output['error']}");

/* Backup */
$output = backup($now, $timezone, $basePath);
if (!$minOutput) logOutput($output);
if (isset($output['error'])) logEnd($now, "{$output['error']}");

logEnd($now, $output['content'] ?? "Complete");
