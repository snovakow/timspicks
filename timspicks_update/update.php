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
    This file and fetch_lib.php are deployed to different folders and have to be copied together,
    fetch_lib.php first (docs/deployment.md, step 5): nothing here is built or type-checked, so a
    signature change over there surfaces as a fatal in the cron log, and only in whichever branch
    happens to be reachable at that hour.
*/
$codeRoot = $_GET['lib'] ?? 'public';
require_once "../{$codeRoot}/fetch_lib.php";

/* Decode a JSON file, or null when it's missing or unreadable */
function readJson(string $path)
{
    if (!file_exists($path)) return null;

    $data = file_get_contents($path);
    if ($data === false) return null;

    return json_decode($data, true);
}

/* A timestamp out of process.json: "processed" is the last complete run, "started" a run that never finished */
function runTime(string $basePath, string $key)
{
    $data = readJson($basePath . '/process.json');
    if (!is_array($data)) return null;

    $data = $data[$key] ?? null;
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
    $data = readJson($basePath . '/games.json');
    if (!is_array($data)) return null;

    $data = $data["gameWeek"] ?? null;
    if (!isset($data)) return null;

    $data = $data[0] ?? null;
    if (!isset($data)) return null;

    if (!isset($data["date"])) return null;

    $date = DateTime::createFromFormat('Y-m-d', $data["date"]);
    if ($date === false) return null;

    if ($date->format('Y-m-d') !== $now->format('Y-m-d')) return null;

    $games = $data["games"] ?? null;
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

/*
    True when helper.json still lists a team whose game has started, so the feed hadn't
    redrawn its list yet when that list was pulled. Returns false on anything unexpected:
    a missing or odd file shouldn't pin the gate to the retry period.
*/
function staleList(DateTime $now, int $updateBuffer, string $basePath)
{
    $games = readJson($basePath . '/games.json');
    $helper = readJson($basePath . '/helper.json');
    if (!is_array($games) || !is_array($helper)) return false;

    $cutoff = $now->getTimestamp() - $updateBuffer;

    $started = [];
    foreach ($games["gameWeek"][0]["games"] ?? [] as $game) {
        // A postponed game's start time isn't one a redraw would have reacted to
        if (($game["gameScheduleState"] ?? 'OK') !== 'OK') continue;
        if (!isset($game["startTimeUTC"])) continue;

        try {
            $gameTime = new DateTime((string)$game["startTimeUTC"]);
        } catch (Exception $e) {
            continue;
        }
        if ($gameTime->getTimestamp() > $cutoff) continue;

        foreach ([$game["awayTeam"]["abbrev"] ?? null, $game["homeTeam"]["abbrev"] ?? null] as $abbrev) {
            if ($abbrev !== null) $started[$abbrev] = true;
        }
    }
    if (empty($started)) return false;

    foreach (["1", "2", "3"] as $key) {
        foreach ($helper[$key] ?? [] as $row) {
            if (isset($row["team"]) && isset($started[$row["team"]])) return true;
        }
    }

    return false;
}

/*
    True when helper.json holds a draw the feed made on an earlier day: the first run after
    midnight can land before the feed posts the day's first draw, leaving yesterday's final list
    up against today's games. Returns false when helper.json predates the stamp, for the same
    reason staleList does.
*/
function earlierDraw(DateTime $now, string $basePath)
{
    $helper = readJson($basePath . '/helper.json');
    if (!is_array($helper) || !is_string($helper["dateTimeAvailable"] ?? null)) return false;

    return substr($helper["dateTimeAvailable"], 0, 10) !== $now->format('Y-m-d');
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
    b. Update $period since the previous run, or as soon as a game start time has passed.
    c. Don't update within $updateBuffer seconds from a game start time or midnight.
    d. Inside the game window, a failed run or a list the feed hadn't redrawn yet
       retries on $retryPeriod instead of $updatePeriod, and so does a list left over from
       an earlier day in the hour after midnight.
*/
$updatePeriod = 60 * 60;
$retryPeriod = 5 * 60;
$updateBuffer = 1 * 60;

/*
    The gate below needs a today-dated games.json, which the first run after rollover has
    not fetched yet, so the one check that must not depend on it comes first.
*/

// c, midnight half
if ($nowTime <= $startOfDayTime + $updateBuffer) {
    if ($minOutput) die();
    logEnd($now, "Not updating within the buffer of midnight");
}

$processDate = runTime($basePath, 'processed');
$startedDate = runTime($basePath, 'started');

// A run that died before writing "processed", which the next attempt measures from
$failedDate = $startedDate !== null && ($processDate === null || $startedDate > $processDate) ? $startedDate : null;
$lastRunDate = $failedDate ?? $processDate;

// Narrowed to $retryPeriod below, once games.json gives the window
$period = $updatePeriod;

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

    $lastRunTime = $lastRunDate->getTimestamp();

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
        if ($gameTime >= $lastRunTime && $gameTime <= $nowTime) {
            $gamePassedSinceLastUpdate = true;
        }
    }

    /*
        d. A missed pull between the first and last game costs a draw twice over: the live
        list is wrong until the next run, and that slot's snapshot never gets written. So a
        failed run, or a list the feed hadn't redrawn yet, retries on the shorter period
        there and stays on the full one outside the window. Rule a caps the window's end.

        A list left over from an earlier day also retries on the shorter period, but only in the
        hour after midnight, where a feed slow to roll over leaves one. Past that hour it waits
        the full period, so a day the feed never posts doesn't pull every few minutes until the
        last game.
    */
    $inGameWindow = $nowTime >= $gameTimes[0]->getTimestamp() - $updatePeriod;
    $inRollover = $nowTime < $startOfDayTime + $updatePeriod;
    if ($inGameWindow && ($failedDate !== null || staleList($now, $updateBuffer, $basePath))) {
        $period = $retryPeriod;
    } else if ($inRollover && earlierDraw($now, $basePath)) {
        $period = $retryPeriod;
    }

    // b. Only update if $period has passed since the last run, unless a game start time has passed since then
    if (!$gamePassedSinceLastUpdate && $nowTime - $lastRunTime < $period) {
        if ($minOutput) die();
        logEnd($now, "Not updating");
    }
} else if ($failedDate !== null && $nowTime - $failedDate->getTimestamp() < $period) {
    /*
        No today-dated games.json, so the window is unknown: a failed run waits out the full
        period rather than the retry one, keeping a rollover that can't reach the schedule
        feed from being retried every minute.
    */
    if ($minOutput) die();
    logEnd($now, "Not retrying within the update period of a failed run");
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
    logStep($now, $output, $minOutput);
    logEnd($now, $output['content'] ?? "Complete");
} else {
    processed($now, $basePath, $warnings);
    logEnd($now, "Complete, no backup before 3am");
}
