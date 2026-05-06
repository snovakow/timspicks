import * as Feature from '../features';
import { Sportsbooks, StrategyLabels } from '../dataTypes';
import { getEntries } from '../utility';

import './InfoPopupContent.css';
import "./sportsbook.css";

export default function InfoPopupContent() {
	return (
		<div className="info-popup-layout">
			<section className="info-popup-section">
				<h3>Tim Hortons Hockey Challenge</h3>
				<p>
					This app helps you make Tim Hortons Hockey Challenge picks in the Tims app.
					It ranks candidates for Pick #1, Pick #2, and Pick #3 using implied probabilities
					from sportsbook odds.
				</p>
			</section>

			<section className="info-popup-section">
				<h3>Sportsbooks</h3>
				<div className="sportsbook-list" >
					{getEntries(Sportsbooks).map(([key, book]) => (
						<div key={key} className="sportsbook-item">
							<img className="sportsbook-logo sportsbook-logo-rounded" src={book.logo} alt={`${book.title} logo`} />
							<span>{book.title}</span>
						</div>
					))}
				</div>
			</section>

			{Feature.allPlayersTable && (
				<section className="info-popup-section">
					<h3>Features</h3>
					<p>
						Once games start, available pick quality can shift.
						Listing all players with game start times helps judge
						whether to lock picks early or wait for later opportunities.
					</p>
				</section>
			)}

			{Feature.normalizeSportsbooks && (
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
				<h3>Stats</h3>
				<p>
					The <strong>Stats</strong> button displays the top picks from the average sportsbook's odds,
					with sportsbook buttons to dispaly the top picks specific to each sportsbook.
				</p>
				<p>
					Selecting an already selected sportsbook deselects it,
					restores the display to the average results.
				</p>
			</section>

			{Feature.correlation && (
				<section className="info-popup-section">
					<h3>Log Points (<i>𝑳%</i>) Correlation</h3>
					<p>
						Log points: Used to denote logarithmic changes scaled to act like percentages,
						used as a baseline for relative change.
					</p>
					<p>
						A log-ratio baseline correlation is used to estimate how much picks from the same game,
						whether on opposing teams or the same team,
						are correlated relative to a baseline of independent picks from different games.
					</p>
					<p>
						With 2 or less games where all three picks cannot be independent from different games,
						correlation is based on random results.
					</p>
				</section>
			)}

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
					<span className="legend-strategy-text"><strong>{StrategyLabels.least1} (Green): </strong>
						Best picks for streaks. Getting at least one pick correct for 7 straight days earns free coffee for a week.
					</span>
				</p>
				<p className="legend-strategy-row"><span className="legend-strategy-dot info-chip-points-left-dot" aria-hidden="true" />
					<span className="legend-strategy-text"><strong>{StrategyLabels.points} (Blue): </strong>
						Best picks for maximum points. 1 correct = 25 points, 2 correct = 50 points, 3 correct = 100 points.
					</span>
				</p>
				<p className="legend-strategy-row"><span className="legend-strategy-dot info-chip-hits-left-dot" aria-hidden="true" />
					<span className="legend-strategy-text"><strong>{StrategyLabels.hits} (Amber): </strong>
						Best picks for competing on the leaderboard.
					</span>
				</p>
				<p className="legend-strategy-row"><span className="legend-strategy-dot info-chip-top-left-dot" aria-hidden="true" />
					<span className="legend-strategy-text"><strong>{StrategyLabels.top} (Navy): </strong>
						Highest-probability picks.
					</span>
				</p>
			</section>
		</div>
	);
}