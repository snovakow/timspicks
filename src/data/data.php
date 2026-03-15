<?php
session_start();

// Generate a new token if one doesn't exist in the session
if (empty($_SESSION['csrf_token'])) {
    // Use a cryptographically secure method to generate the token
    // random_bytes() is preferred over md5(uniqid())
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

$csrfToken = $_SESSION['csrf_token'];
?>
<!DOCTYPE html>
<html>

<head>
    <title>Data Fetcher</title>
</head>

<body>
    <select id="option">
        <option value="" disabled selected>Option</option>
        <option value="picks">Picks</option>
        <option value="odds">Odds</option>
        <option value="picks,odds">Picks + Odds</option>
        <option value="games">Games</option>
        <option value="picks,odds,games">All</option>
    </select>

    <input type="text" id="name" />
    <input type="password" id="input" />
    <button id="button">Submit</button>
    <p id="response"></p>

    <script>
        const button = document.getElementById('button');
        const name = document.getElementById('name');
        const input = document.getElementById('input');

        const keydown = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                button.focus();
                button.click();
            }
        };
        name.addEventListener("keydown", keydown);
        input.addEventListener("keydown", keydown);

        button.addEventListener('click', async () => {
            const option = document.getElementById('option');
            const options = option.value;
            if (!options) return;

            const optionList = options.split(",");

            const data = {
                name: name.value,
                code: input.value,
                csrf_token: "<?php echo htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>"
            };

            const responseElement = document.getElementById('response');
            responseElement.innerHTML = "";
            // button.disabled = true; // Disable the button to prevent multiple clicks
            // button.parentElement.removeChild(button); // Remove the button from the DOM
            // input.parentElement.removeChild(input); // Remove the input from the DOM

            const response = await fetch("./fetch.php?" + optionList.join("&"), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data) // Converts JavaScript object to a JSON string
            });

            // Handle the response from the server
            const result = await response.text();
            if (result) responseElement.innerHTML = result;
        });
    </script>

</body>

</html>