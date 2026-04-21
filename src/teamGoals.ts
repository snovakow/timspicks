import { type Team, isTeam } from "./components/logo";

// Given data.selections (team total goals market), calculate the expected (mean) number of goals as a decimal
type DataSelection = {
    points: number;
    label: string;
    displayOdds: { decimal: string };
    participants: { seoIdentifier: string }[];
};
export function expectedGoals(selections: Array<DataSelection>): number | null {
    // Group selections by points
    const grouped: Record<number, { over?: number; under?: number }> = {};
    for (const sel of selections) {
        const pts = sel.points;
        const dec = Number(sel.displayOdds.decimal);
        if (!grouped[pts]) grouped[pts] = {};
        if (sel.label === 'Over') grouped[pts].over = dec;
        if (sel.label === 'Under') grouped[pts].under = dec;
    }
    // For each interval, calculate implied probability for "exactly" that goal total
    // P(exact k) = P(over k-0.5) - P(over k+0.5)
    // For each integer k, find the interval (k-0.5, k+0.5)
    const probs: Record<number, number> = {};
    const sortedPoints = Object.keys(grouped).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < sortedPoints.length - 1; ++i) {
        const lower = sortedPoints[i];
        const upper = sortedPoints[i + 1];
        const overLower = grouped[lower].over;
        const overUpper = grouped[upper].over;
        if (overLower && overUpper) {
            // Implied probability for over at each line
            const pLower = 1 / overLower;
            const pUpper = 1 / overUpper;
            // Normalize (de-vig)
            const norm = pLower - pUpper;
            // The most probable integer is at lower+0.5 (i.e., lower+1)
            probs[lower + 0.5] = norm;
        }
    }
    // Normalize probabilities to sum to 1
    const totalProb = Object.values(probs).reduce((a, b) => a + b, 0);
    if (totalProb === 0) return null;
    // Compute expected value (mean)
    let mean = 0;
    for (const k in probs) {
        mean += Number(k) * (probs[k] / totalProb);
    }
    return mean;
}

const NAV_URL = "https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=42133&eventsQuery=%24filter%3DleagueId%20eq%20%2742133%27%20AND%20clientMetadata%2FSubcategories%2Fany%28s%3A%20s%2FId%20eq%20%2716716%27%29&marketsQuery=%24filter%3DclientMetadata%2FsubCategoryId%20eq%20%2716716%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&include=Events&entity=events";

const odds1 = "https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/event/eventSubcategory/v1/markets?isBatchable=false&templateVars=";
const odds2 = "&marketsQuery=%24filter%3DeventId%20eq%20%27";
const odds3 = "%27%20AND%20clientMetadata%2FsubCategoryId%20eq%20%2716716%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&entity=markets";
async function getTomorrowEventIds() {
    const res = await fetch(NAV_URL);
    const data = await res.json();

    return data;
}

export async function getTeamTotalsForAllGames() {
    const json = await getTomorrowEventIds();
    const today = new Date().toDateString();
    const results: Map<Team, number> = new Map();
    for (const event of json.events) {
        const startDate = new Date(event.startEventDate);
        if (startDate.toDateString() !== today) continue;

        const url = odds1 + event.id + odds2 + event.id + odds3;
        const res = await fetch(url);
        const data = await res.json();

        const selections: Map<string, DataSelection[]> = new Map();
        for (const selection of data.selections) {
            const name = selection.participants[0].name;
            if (!selections.has(name)) {
                selections.set(name, []);
            }
            selections.get(name)!.push(selection);
        }
        for (const [name, selection] of selections) {
            const xG = expectedGoals(selection);
            if (xG === null) continue;
            // console.log(name, xG.toFixed(1));

            const parse = name.split(" ");
            if (parse.length < 1) continue;

            const team = parse[0];
            if (team.length === 2 && parse.length > 1) {
                const initial = parse[1];
                if (initial && initial.length > 0) {
                    const name = (team + initial[0]);
                    if (isTeam(name)) results.set(name, xG);
                }
                continue;
            }
            if (team.length === 3) {
                if (isTeam(team)) results.set(team, xG);
            }
        }
    }
    return results;
}
