import './InfoPopupContent.css';
import * as Feature from '../features';

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

			{Feature.normalize && (
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
						In the <strong>Settings</strong>,
						use the <strong>Show Probabilities</strong> toggle to switch between percentage and American odds display,
						and the <strong>Normalize Sportsbooks</strong> to toggle normalized percentages.
					</p>
				</section>
			)}

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

			<section className="info-popup-section info-popup-contact">
				<h3>Contact</h3>
				<p><a href="mailto:snovakow@gmail.com">snovakow@gmail.com</a></p>
			</section>
		</div>
	);
}

export function LegendPopupContent() {
	return (
		<div className="info-popup-layout">
			<section className="info-popup-section">
				<p className="legend-pick-row"><span className="cell-bet-with-dots legend-badge-cell highlight-top-bg">
					<span className="cell-bet-value">Pick</span>
					<span className="cell-strategy-dots" aria-hidden="true">
						<span className="cell-strategy-dot cell-strategy-dot-least1 cell-strategy-dot-active" />
						<span className="cell-strategy-dot cell-strategy-dot-points cell-strategy-dot-active" />
						<span className="cell-strategy-dot cell-strategy-dot-hits cell-strategy-dot-active" />
						<span className="cell-strategy-dot cell-strategy-dot-top cell-strategy-dot-active" />
					</span>
				</span>
					<span className="legend-pick-text">Green background highlight indicates a highest-probability pick, with circular badges indicating which strategies correspond to the pick.</span></p>
			</section>

			<section className="info-popup-section">
				<h3>Strategy</h3>
				<p className="legend-strategy-row"><span className="legend-strategy-dot info-chip-least1-left-dot" aria-hidden="true" />
					<span className="legend-strategy-text"><strong>Streak (Green): </strong>
						Best picks for streaks. Getting at least one pick correct for 7 straight days earns free coffee for a week.
					</span>
				</p>
				<p className="legend-strategy-row"><span className="legend-strategy-dot info-chip-points-left-dot" aria-hidden="true" />
					<span className="legend-strategy-text"><strong>Points (Blue): </strong>
						Best picks for maximum points. 1 correct = 25 points, 2 correct = 50 points, 3 correct = 100 points.
					</span>
				</p>
				<p className="legend-strategy-row"><span className="legend-strategy-dot info-chip-hits-left-dot" aria-hidden="true" />
					<span className="legend-strategy-text"><strong>Pick % (Amber): </strong>
						Best picks for competing on the leaderboard.
					</span>
				</p>
				<p className="legend-strategy-row"><span className="legend-strategy-dot info-chip-top-left-dot" aria-hidden="true" />
					<span className="legend-strategy-text"><strong>Top (Navy): </strong>
						Highest-probability picks.
					</span>
				</p>
			</section>
		</div>
	);
}