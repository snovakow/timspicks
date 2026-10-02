<?php
/*
1. Enter crontab edit mode: crontab -e
2. Enter insert mode: i
3. Type command: * * * * * curl "https://snovakow.sensitive/update.php?lib=public" >> timspicks_log.txt
                 * * * * * curl "https://snovakow.sensitive/update.php?lib=live/timspicks" >> timspicks_log.txt
4. Save the file: Esc, :w, Enter
5. Quit vim: :q
6. List your cron jobs: crontab -l

Delete all crontabs: crontab -r
*/

/*
    This file and fetch_lib.php are deployed to different folders and have to be copied together:
    nothing here is built or type-checked, so a signature change over there surfaces as a fatal in
    the cron log, and only in whichever branch happens to be reachable at that hour.
*/
$codeRoot = $_GET['lib'] ?? 'public';
require_once "../{$codeRoot}/fetch_lib.php";

/* A timestamp out of process.json: "processed" is the last complete run, "started" a run that never finished */
function runTime(string $basePath, string $key)
{
    $local_file = $basePath . '/process.json';
    if (!file_exists($local_file)) return null;

    $data = file_get_contents($local_file);
    if ($data === false) return null;

    $data = json_decode($data, false);
    if ($data === null) return null;

    $data = $data->$key ?? null;
    if (!isset($data)) return null;

    try {
        $date = new DateTime((string)$data);
    } catch (Exception $e) {
        return null;
    }

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
        if (!isset($game["startTimeUTC"])) continue;

        try {
            $gameTime = new DateTime((string)$game["startTimeUTC"]);
        } catch (Exception $e) {
            continue;
        }

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

/* Log a step's result, stopping the run on error, and return its warnings */
function logStep(DateTime $now, array $output, bool $minOutput)
{
    if (!$minOutput) logOutput($output);
    if (isset($output['error'])) logEnd($now, "{$output['error']}");

    return $output['warning'] ?? [];
}

$basePath = "../{$codeRoot}/data";
if (!is_dir($basePath)) mkdir($basePath, 0755, true);

$timezone = new DateTimeZone('America/New_York');
$now = new DateTime('now', $timezone);

$nowTime = $now->getTimestamp();
$startOfDayTime = (new DateTime('today midnight', $timezone))->getTimestamp();

$minOutput = true;

/*
    a. Don't update between the last game and midnight.
    b. Update $updatePeriod since the previous update, unless a game start time has passed.
    c. Don't update within $updateBuffer seconds from a game start time or midnight.
    d. Don't retry within $updatePeriod of a run that failed.
*/
$updatePeriod = 60 * 60;
$updateBuffer = 1 * 60;

/*
    The gate below needs a today-dated games.json, which the first run after rollover has
    not fetched yet, so the two checks that must not depend on it come first.
*/

// c, midnight half
if ($nowTime <= $startOfDayTime + $updateBuffer) {
    if ($minOutput) die();
    logEnd($now, "Not updating within the buffer of midnight");
}

$processDate = runTime($basePath, 'processed');
$startedDate = runTime($basePath, 'started');

// d. A run that died before writing "processed" holds off the next attempt for
// $updatePeriod, so a failing feed is retried hourly instead of every minute
$failedDate = $startedDate !== null && ($processDate === null || $startedDate > $processDate) ? $startedDate : null;
if ($failedDate !== null && $nowTime - $failedDate->getTimestamp() < $updatePeriod) {
    if ($minOutput) die();
    logEnd($now, "Not retrying within the update period of a failed run");
}

$lastRunDate = $failedDate ?? $processDate;

$gameTimes = processGames($now, $basePath);
if ($lastRunDate !== null && $gameTimes !== null) {
    if (count($gameTimes) === 0) {
        if ($minOutput) die();
        logEnd($now, "No games found");
    }

    // a. Don't update between the last game and midnight
    $lastGameTime = end($gameTimes)->getTimestamp();

    if ($nowTime >= $lastGameTime - $updateBuffer) {
        if ($minOutput) die();
        logEnd($now, "Not updating between last game and midnight");
    }

    $processTime = $lastRunDate->getTimestamp();

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
    $timeSinceProcess = $nowTime - $processTime;
    if (!$gamePassedSinceLastUpdate && $timeSinceProcess < $updatePeriod) {
        if ($minOutput) die();
        logEnd($now, "Not updating");
    }
}

if (!$minOutput) echo "Data Downloader\n";

// Record the attempt before any fetch, so a run that dies partway is the "started" that check d reads
$warnings = [];
startRun($now, $basePath);

/* Games */
$output = updateGames($now, $basePath);
$warnings = array_merge($warnings, logStep($now, $output, $minOutput));

$ch = curl_init();

/* Picks */
$playersPath = "../{$codeRoot}/players";
$output = updatePicks($ch, $basePath, $playersPath);
$warnings = array_merge($warnings, logStep($now, $output, $minOutput));

/* DraftKings */
$output = updateBet1($ch, $basePath);
$warnings = array_merge($warnings, logStep($now, $output, $minOutput));

$endOfDay = new DateTime('tomorrow midnight', $timezone);

/* FanDuel */
$output = updateBet2($endOfDay, $ch, $basePath);
$warnings = array_merge($warnings, logStep($now, $output, $minOutput));

/* BetMGM */
$output = updateBet3($endOfDay, $ch, $basePath);
$warnings = array_merge($warnings, logStep($now, $output, $minOutput));

/* BetRivers */
$output = updateBet4($endOfDay, $basePath);
$warnings = array_merge($warnings, logStep($now, $output, $minOutput));

/* Backup */
// Don't backup before 3am to make sure any time zone changes have passed
if ($nowTime > $startOfDayTime + 60 * 60 * 3) {
    $output = backup($now, $timezone, $basePath, $warnings);
    $warnings = array_merge($warnings, logStep($now, $output, $minOutput));
} else {
    processed($now, $basePath, $warnings);
}

logEnd($now, $output['content'] ?? "Complete");
