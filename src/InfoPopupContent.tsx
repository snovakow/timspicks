import './InfoPopupContent.css';

export default function InfoPopupContent() {
	return (
		<div className="info-popup-layout">
			<section className="info-popup-section">
				<h3>Tim Hortons Hockey Challenge</h3>
				<p>
					This app helps you make Tim Hortons Hockey Challenge picks in the Tims app.
					It ranks candidates for Pick #1, Pick #2, and Pick #3 using implied probabilities
					from sportsbook odds, with normalization to improve book-to-book comparability.
				</p>
			</section>

			<section className="info-popup-section">
				<h3>Features</h3>
				<p>
					Selecting picks from different games can improve total hit probability by reducing
					correlation between picks. When picks come from independent games, outcomes are
					less tied together than when multiple picks come from the same game.
				</p>
				<p>
					Once games start, available pick quality can shift. Listing all players helps judge
					whether to lock picks early or wait for later opportunities.
				</p>
			</section>

			<section className="info-popup-section">
				<h3>How Odds Are Balanced</h3>
				<p>
					The percentages shown are implied probabilities derived from sportsbook odds.
					The app then normalizes books to reduce systematic pricing differences so books are more comparable.
				</p>
				<p>
					In practice, this means each sportsbook is scaled toward the consensus of the other books
					(de-vig normalization), helping separate real player signal from sportsbook-specific bias.
				</p>
				<p>
					Sportsbooks include a margin known as <strong>vig</strong> (also called <strong>juice</strong>),
					so normalization helps align books onto a more comparable baseline.
				</p>
				<p>
					Use the <strong>#</strong> button to switch between percentage view and American odds view.
				</p>
			</section>

			<section className="info-popup-section">
				<h3>Stats and Sportsbook Buttons</h3>
				<p>
					The <strong>📊</strong> stats button and sportsbook logo buttons display the top picks
					and, when multiple picks are from the same game, the next-best alternatives from different games when available.
				</p>
				<p>
					The sportsbook buttons (DraftKings, FanDuel, BetMGM, or BetRivers)
					display the picks using that sportsbook's odds.
					The <strong>📊</strong> stats button displays the picks based on the average odds across all
					sportsbooks.
				</p>
				<p>
					This lets you compare how picks change by source while keeping one consistent optimization method.
				</p>
			</section>

			<section className="info-popup-section">
				<h3>Highlight Legend</h3>
				<p><span className="info-chip info-chip-four-dot info-chip-four-dot-top">Top</span>
					Highest-probability pick, but not optimal for any strategy.</p>
				<p><span className="info-chip info-chip-four-dot info-chip-four-dot-top-optimum">Best</span>
					Highest-probability pick and optimal for a strategy.</p>
				<p><span className="info-chip info-chip-four-dot info-chip-four-dot-optimum">Optimal</span>
					Not the highest-probability pick, but optimal for a strategy.</p>
			</section>

			<section className="info-popup-section">
				<h3>Strategy Legend</h3>
				<p><span className="info-chip info-chip-left-dot info-chip-streak-left-dot">Green</span>
					Best picks for streaks. Getting at least one pick correct for 7 straight days earns free coffee for a week.</p>
				<p><span className="info-chip info-chip-left-dot info-chip-point-left-dot">Magenta</span>
					Best picks for maximum points. 1 correct = 25 points, 2 correct = 50 points, 3 correct = 100 points. Also strong for streaks
					and the best overall strategy.</p>
				<p><span className="info-chip info-chip-left-dot info-chip-leaderboard-left-dot">Amber</span>
					Best picks for competing on the leaderboard. High-risk, high-reward strategy.</p>
				<p><span className="info-chip info-chip-left-dot info-chip-hybrid-left-dot">Blue</span>
					Hybrid strategy balanced between streak safety and point upside.</p>
			</section>

			<section className="info-popup-section info-popup-contact">
				<h3>Contact</h3>
				<p><a href="mailto:snovakow@gmail.com">snovakow@gmail.com</a></p>
			</section>
		</div>
	);
}