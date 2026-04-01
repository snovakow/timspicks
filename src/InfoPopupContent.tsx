import './InfoPopupContent.css';

export default function InfoPopupContent() {
    return (
        <>
            <div className="info-popup-section">
                <p><strong>What this app does</strong></p>
                <p>This app shows NHL anytime goal scorer probabilities from four sportsbooks — DraftKings, FanDuel, BetMGM, and BetRivers — for today's games.</p>
                <p>The percentages are <strong>implied probabilities</strong> derived from each sportsbook's offered odds. For example, odds of −150 imply a 60% chance. Sportsbooks build a profit margin (vig or juice) into their lines, so the displayed probabilities are slightly inflated relative to the true odds. The <strong>#</strong> button switches the display to show the original American odds instead.</p>
                <p>Three picks are nominated per slot (Pick #1, #2, #3). The goal is to select one player per slot with the highest chance of scoring, where no two picks play in the same game.</p>
                <p>The <strong>Avg</strong> column is the mean implied probability across all sportsbooks that list the player. The <strong>G/GP</strong> column shows each player's goals-per-game rate, converted to a Poisson goal probability for reference.</p>
                <p>Clicking a sportsbook logo shows that book's optimal picks. The <strong>📊</strong> button shows the optimal picks by average, accounting for game conflicts.</p>
            </div>
            <div className="info-popup-section info-popup-section-break">
                <p><strong>Highlight legend</strong></p>
                <p><span style={{ background: 'rgb(204,238,255)', color: '#000', padding: '0 0.4em', borderRadius: 3 }}>Blue</span> — Highest probability in that sportsbook column for that pick table.</p>
                <p><span style={{ background: 'rgb(170,235,170)', color: '#000', padding: '0 0.4em', borderRadius: 3 }}>Green</span> — Player identified as an optimal pick for that slot by the stats analysis.</p>
            </div>
            <div className="info-popup-section info-popup-section-break">
                <p><strong>Contact</strong></p>
                <p><a href="mailto:snovakow@gmail.com">snovakow@gmail.com</a></p>
            </div>
        </>
    );
}