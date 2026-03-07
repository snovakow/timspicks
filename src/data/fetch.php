<?php
$live = true;
$secure = true;

if ($live && $secure) {
    session_start();

    if (!isset($_SESSION['csrf_token'])) {
        die();
    }

    $csrf_token = $_SESSION['csrf_token'];
    unset($_SESSION['csrf_token']);

    // header('HTTP/1.1 500 Internal Server Error');

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        die();
    }

    // Read the raw POST data from the input stream
    $json_data = file_get_contents('php://input');

    // Decode the JSON data into a PHP associative array
    $data = json_decode($json_data, true);

    if (!isset($data['code']) || !isset($data['name'])) {
        // CSRF token validation failed, stop the request and handle the error
        die();
    }

    if (!hash_equals($csrf_token, $data['csrf_token'])) {
        // CSRF token validation failed, stop the request and handle the error
        die('Invalid CSRF token. Request aborted.');
    }

    // If the token is valid, process the form data safely
    // ... continue processing form data ...

    // Optional: Unset the token after a single use for added security (token rotation)

    if (!hash_equals('snovakow', $data['name']) || !hash_equals('sept2376', $data['code'])) {
        // CSRF token validation failed, stop the request and handle the error
        die();
    }
}

echo '<h1>Data Downloader</h1>';

$ch = curl_init();

/*

   Helper

*/
if ($live) {
    echo '<h2>Helper</h2>';

    $helper = 'https://api.hockeychallengehelper.com/api/picks';
    echo "{$helper}<br>";

    // 2. Set options
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

    // 3. Execute the cURL request
    $response = curl_exec($ch);

    // Check for errors
    if ($response === false) {
        echo 'cURL Error: ' . curl_error($ch);
    }

    // 4. Close the cURL session
    // curl_close($ch);

    $local_file = './helper.json';
    if (file_put_contents($local_file, $response) === false) {
        die('Error saving local JSON file.');
    }
    echo "<br>Data has been written to $local_file.";
}

/*

   DraftKings

*/
if ($live) {
    echo '<h2>DraftKings</h2>';

    $draftkings = 'https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=42133%2C13809&eventsQuery=%24filter%3DleagueId%20eq%20%2742133%27%20AND%20clientMetadata%2FSubcategories%2Fany%28s%3A%20s%2FId%20eq%20%2713809%27%29&marketsQuery=%24filter%3DclientMetadata%2FsubCategoryId%20eq%20%2713809%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&include=Events&entity=events';
    echo "{$draftkings}<br>";

    curl_reset($ch);

    // 2. Set options
    curl_setopt($ch, CURLOPT_URL, $draftkings); // Set the URL
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true); // Return the response as a string instead of outputting it directly

    // 3. Execute the cURL request
    $response = curl_exec($ch);

    // Check for errors
    if ($response === false) {
        echo 'cURL Error: ' . curl_error($ch);
    }

    // 4. Close the cURL session
    // curl_close($ch);

    $local_file = './draftkings.json';
    if (file_put_contents($local_file, $response) === false) {
        die('Error saving local JSON file.');
    }
    echo "<br>Data has been written to $local_file.";
}

/*

   FanDuel

*/
if ($live) {
    echo '<h2>FanDuel</h2>';

    $fanduel = 'https://sbapi.on.sportsbook.fanduel.ca/api/content-managed-page?page=CUSTOM&customPageId=nhl&pbHorizontal=false&_ak=FhMFpcPWXMeyZxOx&timezone=America%2FNew_York';
    echo "{$fanduel}<br>";

    curl_reset($ch);

    // 2. Set options
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

    // 3. Execute the cURL request
    $response = curl_exec($ch);

    // Check for errors
    if ($response === false) {
        echo 'cURL Error: ' . curl_error($ch);
    }

    $local_file = './fanduel.json';
    if (file_put_contents($local_file, $response) === false) {
        die('Error saving local JSON file.');
    }
    echo "<br>Data has been written to $local_file.";
}

/*

   BetRivers

*/
if ($live) {
    echo '<h2>BetRivers</h2>';
    $remote_url_base = 'https://on.betrivers.ca/api/service/sportsbook/offering/propcentral/offers?groupId=1000093657&marketCategory=TO_SCORE&pageSize=20&cageCode=249&t=' . time() . '&pageNr=';

    // Fetch the remote JSON data as a string
    $remote_url = $remote_url_base . '1';
    echo "{$remote_url}<br>";
    $json_data = file_get_contents($remote_url); // Append page number to the URL

    if ($json_data === false) {
        die('Error fetching remote JSON file.');
    }

    // To immediately use the JSON data within your PHP script, decode it into a PHP array or object
    $data_array = json_decode($json_data, false); // true for an associative array
    // var_dump($data_array->paging->totalPages); // Output the decoded data for verification
    if (json_last_error() !== JSON_ERROR_NONE) {
        die('Error decoding JSON: ' . json_last_error_msg());
    }

    $items = [$data_array->items];

    $pages = $data_array->paging->totalPages;
    echo "<br>{$pages} pages<br>";
    for ($i = 2; $i <= $pages; $i++) {
        $remote_url = $remote_url_base . $i;
        $json_data = file_get_contents($remote_url); // Append page number to the URL

        if ($json_data === false) {
            die('Error fetching remote JSON file.');
        }

        $data_array = json_decode($json_data, false); // true for an associative array
        if (json_last_error() !== JSON_ERROR_NONE) {
            die('Error decoding JSON: ' . json_last_error_msg());
        }

        $items[] = $data_array->items;
    }


    $merged_array = array_merge([], ...$items);

    $json_string = json_encode($merged_array, JSON_UNESCAPED_UNICODE);

    // Define the file path
    $local_file = './betrivers.json'; // Update local file name for the current page

    // 3. Write the JSON string to the file and handle errors
    if (file_put_contents($local_file, $json_string, LOCK_EX) !== false) {
        echo "<br>Data has been merged and written to $local_file.";
    } else {
        echo "Error occurred while writing to $local_file.";
    }
}

/*

   5V5Hockey

*/
if ($live) {
    echo '<h2>5v5Hockey</h2>';
    $remote_url = 'https://5v5hockey.com/ai-betting/tims-picks/';

    echo "{$remote_url}<br>";
    $data = file_get_contents($remote_url);

    if ($data === false) {
        die('Error fetching remote HTML file.');
    }

    $start = strpos($data, 'const table_1_data');
    if ($start === false) die('Parsing Error');

    $end = strpos($data, 'gridTimsPicks(');
    if ($end === false) die('Parsing Error');

    $data = substr($data, $start, $end - $start);

    $data = str_replace('const table_1_data = ', 'export const table_1_data = ', $data);
    $data = str_replace('const table_2_data = ', 'export const table_2_data = ', $data);
    $data = str_replace('const table_3_data = ', 'export const table_3_data = ', $data);

    $local_file = './5v5hockey.js';
    if (file_put_contents($local_file, $data, LOCK_EX) !== false) {
        echo "<br>Data has been written to $local_file.";
    } else {
        echo "Error occurred while writing to $local_file.";
    }
}
