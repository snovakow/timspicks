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
	<link rel="stylesheet" href="./data.css">
</head>

<body>
	<div id="form">
		<select id="option">
			<option value="" disabled selected>Option</option>
			<option value="odds">Odds</option>
			<option value="picks">Picks</option>
			<option value="games">Games</option>
			<option value="picks,odds">Picks + Odds</option>
			<option value="picks,odds,games">Games + Picks + Odds</option>
			<option value="backup">Backup</option>
			<option value="players">Players</option>
		</select>
		<input type="text" id="name" />
		<input type="password" id="input" />
		<button id="button">Submit</button>
	</div>

	<div id="response"></div>

	<script>
		const teams = [
			"ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", "EDM",
			"FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT", "PHI", "PIT",
			"SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH"
		];

		const sendRequest = async (query) => {
			const data = {
				name: name.value,
				code: input.value,
				csrf_token: "<?php echo htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>"
			};

			const response = await fetch("./fetch.php?" + query, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(data) // Converts JavaScript object to a JSON string
			});

			// Handle the response from the server
			return await response.text();
		};

		const button = document.getElementById('button');
		const name = document.getElementById('name');
		const input = document.getElementById('input');
		let activeRunId = 0;

		const scrollResponseToBottom = (element) => {
			window.requestAnimationFrame(() => {
				element.scrollTop = element.scrollHeight;
			});
		};

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
			const runId = ++activeRunId;
			const option = document.getElementById('option');
			const options = option.value;
			if (!options) return;

			const responseElement = document.getElementById('response');
			responseElement.replaceChildren();
			responseElement.textContent = "";
			responseElement.scrollTop = 0;

			if (options === "players") {
				let teamIndex = 0;
				const processTeam = async () => {
					if (runId !== activeRunId) return;
					const result = await sendRequest("players&team=" + teams[teamIndex]);
					if (runId !== activeRunId) return;
					if (result) {
						responseElement.insertAdjacentHTML('beforeend', result);
						scrollResponseToBottom(responseElement);
					}

					teamIndex++;

					if (teamIndex < teams.length) {
						window.setTimeout(() => {
							processTeam();
						}, 1000);
					} else {
						responseElement.insertAdjacentHTML('beforeend', "<h2>All teams processed.</h2>");
						scrollResponseToBottom(responseElement);
					}
				}
				processTeam();
				return;
			}

			// button.disabled = true; // Disable the button to prevent multiple clicks
			// button.parentElement.removeChild(button); // Remove the button from the DOM
			// input.parentElement.removeChild(input); // Remove the input from the DOM

			const result = await sendRequest(options.split(",").join("&"));
			if (runId !== activeRunId) return;
			if (result) responseElement.replaceChildren();
			if (result) {
				responseElement.insertAdjacentHTML('beforeend', result);
				scrollResponseToBottom(responseElement);
			}
		});
	</script>

</body>

</html>