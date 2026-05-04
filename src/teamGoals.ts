import { type Team, isTeam } from "./components/logo";

// Given data.selections (team total goals market), calculate the expected (mean) number of goals as a decimal
type DataSelection = {
    points: number;
    label: string;
    displayOdds: { decimal: string };
    participants: { seoIdentifier: string }[];
};

type TeamGoalLine = {
    point: number;
    pOver: number;
};

const poissonSurvival = (mean: number, point: number): number => {
    const maxGoals = Math.floor(point);
    let pmf = Math.exp(-mean);
    let cdf = pmf;
    for (let goals = 1; goals <= maxGoals; goals++) {
        pmf *= mean / goals;
        cdf += pmf;
    }
    return 1 - cdf;
};

const fitPoissonMean = (lines: TeamGoalLine[]): number | null => {
    if (lines.length === 0) return null;

    let bestMean = 0;
    let bestLoss = Number.POSITIVE_INFINITY;

    const score = (mean: number): number => {
        let loss = 0;
        for (const line of lines) {
            const diff = poissonSurvival(mean, line.point) - line.pOver;
            loss += diff * diff;
        }
        return loss;
    };

    for (let mean = 0; mean <= 12; mean += 0.05) {
        const loss = score(mean);
        if (loss < bestLoss) {
            bestLoss = loss;
            bestMean = mean;
        }
    }

    const start = Math.max(0, bestMean - 0.1);
    const end = bestMean + 0.1;
    for (let mean = start; mean <= end; mean += 0.001) {
        const loss = score(mean);
        if (loss < bestLoss) {
            bestLoss = loss;
            bestMean = mean;
        }
    }

    return bestMean;
};

const isHalfGoalLine = (point: number): boolean => Math.abs(point * 2 - Math.round(point * 2)) < 1e-9 && Math.abs(point % 1 - 0.5) < 1e-9;

const expectedGoalsFromLines = (lines: TeamGoalLine[]): number | null => {
    if (lines.length === 0) return null;

    const observedByGoals = new Map<number, number>();
    for (const line of lines) {
        if (!isHalfGoalLine(line.point)) continue;
        observedByGoals.set(Math.floor(line.point) + 1, line.pOver);
    }

    if (observedByGoals.size === 0) return null;

    const fittedMean = fitPoissonMean(lines);
    if (fittedMean === null) return null;

    const maxObservedGoals = Math.max(...observedByGoals.keys());
    let mean = 0;

    // For integer-valued goals, E[X] = sum_{k>=1} P(X >= k).
    // Use the market-implied ladder directly wherever it exists.
    for (let goals = 1; goals <= maxObservedGoals; goals++) {
        const observed = observedByGoals.get(goals);
        mean += observed ?? poissonSurvival(fittedMean, goals - 0.5);
    }

    // Use the fitted tail only beyond the highest quoted line.
    for (let goals = maxObservedGoals + 1; goals <= 20; goals++) {
        const tailProb = poissonSurvival(fittedMean, goals - 0.5);
        mean += tailProb;
        if (tailProb < 1e-6) break;
    }

    return mean;
};

export function expectedGoals(selections: Array<DataSelection>): number | null {
    // Group selections by points
    const grouped: Record<number, { over?: number; under?: number }> = {};
    for (const sel of selections) {
        const pts = sel.points;
        const dec = Number(sel.displayOdds.decimal);
        if (!Number.isFinite(dec) || dec <= 1) continue;

        if (!grouped[pts]) grouped[pts] = {};
        if (sel.label === 'Over') grouped[pts].over = dec;
        if (sel.label === 'Under') grouped[pts].under = dec;
    }

    const sortedPoints = Object.keys(grouped).map(Number).sort((a, b) => a - b);
    if (sortedPoints.length === 0) return null;

    // Convert each market line into a de-vigged survival probability P(goals > point).
    const lines: TeamGoalLine[] = [];
    for (const pts of sortedPoints) {
        const { over, under } = grouped[pts];
        let pOver: number | undefined;
        if (over && under) {
            const invOver = 1 / over;
            const invUnder = 1 / under;
            pOver = invOver / (invOver + invUnder);
        } else if (over) {
            pOver = 1 / over;
        } else if (under) {
            pOver = 1 - 1 / under;
        }

        if (pOver !== undefined) {
            lines.push({ point: pts, pOver: Math.min(1, Math.max(0, pOver)) });
        }
    }

    return expectedGoalsFromLines(lines);
}

async function getTeamOdds() {
    const oddsURL = "https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=42133&eventsQuery=%24filter%3DleagueId%20eq%20%2742133%27%20AND%20clientMetadata%2FSubcategories%2Fany%28s%3A%20s%2FId%20eq%20%2716716%27%29&marketsQuery=%24filter%3DclientMetadata%2FsubCategoryId%20eq%20%2716716%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&include=Events&entity=events";
    const res = await fetch(oddsURL);
    const data = await res.json();
    return data;
}

const extractTeam = (name: string): Team | null => {
    const parse = name.split(" ");
    if (parse.length < 1) return null;

    const team = parse[0];
    if (team.length === 2 && parse.length > 1) {
        const initial = parse[1];
        if (initial && initial.length > 0) {
            const name = (team + initial[0]);
            if (isTeam(name)) return name;
        }
        return null;
    }
    if (team.length === 3) {
        if (isTeam(team)) return team;
    }
    return null;
}

export async function getTeamTotals() {
    const json = await getTeamOdds();
    const today = new Date().toDateString();
    const events = new Set<string>();
    const markets = new Set<string>();

    for (const event of json.events) {
        const startDate = new Date(event.startEventDate);
        if (startDate.toDateString() !== today) continue;
        events.add(event.id);
    }

    for (const market of json.markets) {
        if (events.has(market.eventId)) markets.add(market.id);
    }

    const results: Map<Team, number> = new Map();
    const selections: Map<string, DataSelection[]> = new Map();
    for (const selection of json.selections) {
        if (!markets.has(selection.marketId)) continue;

        const name = selection.participants[0].name;
        let selectionList = selections.get(name);
        if (!selectionList) {
            selectionList = [];
            selections.set(name, selectionList);
        }
        selectionList.push(selection);
    }

    for (const [name, selection] of selections) {
        const xG = expectedGoals(selection);
        if (xG === null) continue;

        const team = extractTeam(name);
        if (team) results.set(team, xG);
    }

    return results;
}
