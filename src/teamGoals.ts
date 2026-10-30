import { type Team, isTeam } from "./components/logo";

// Given data.selections (team total goals market), calculate the expected (mean) number of goals as a decimal
type DataSelection = {
    marketId: string;
    points: number;
    label: string;
    displayOdds: { decimal: string };
    participants: { seoIdentifier: string; name?: string }[];
};

type EventData = {
    id: string;
    startEventDate: string;
    name: string;
};

type MarketData = {
    id: string;
    eventId: string;
    name?: string;
    clientMetadata?: {
        name?: string;
    };
};

type FeedData = {
    events: EventData[];
    markets: MarketData[];
    selections: DataSelection[];
};

type TeamGoalLine = {
    point: number;
    pOver: number;
};

type GameEventModel = {
    eventId: string;
    teams: Team[];
    teamLines: Map<Team, TeamGoalLine[]>;
    gameTotals: TeamGoalLine[];
    moneyline: Map<Team, number>;
    puckline: Array<{ team: Team; point: number; pCover: number }>;
};

type FitResult = {
    teamMeans: Map<Team, number>;
    gameMean: number;
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

// The feed's three-letter codes that differ from the app's
const teamAliases: Record<string, Team> = { WAS: "WSH" };

const extractTeam = (name: string): Team | null => {
    const parse = name.split(" ");
    if (parse.length < 1) return null;

    const team = teamAliases[parse[0]] ?? parse[0];
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

const toProbability = (decimalOdds: number): number => 1 / decimalOdds;

const deVigTwoWay = (aDecimal: number, bDecimal: number): [number, number] => {
    const a = toProbability(aDecimal);
    const b = toProbability(bDecimal);
    const total = a + b;
    return [a / total, b / total];
};

const marketName = (market: MarketData): string => (market.name ?? market.clientMetadata?.name ?? "").toLowerCase();

const selectionTeam = (selection: DataSelection): Team | null => {
    const name = selection.participants?.[0]?.name ?? selection.participants?.[0]?.seoIdentifier;
    if (!name) return null;
    return extractTeam(name);
};

const groupByPoints = (selections: DataSelection[]): Map<number, { over?: number; under?: number }> => {
    const grouped = new Map<number, { over?: number; under?: number }>();
    for (const sel of selections) {
        if (typeof sel.points !== "number") continue;
        const dec = Number(sel.displayOdds?.decimal);
        if (!Number.isFinite(dec) || dec <= 1) continue;

        const current = grouped.get(sel.points) ?? {};
        if (sel.label === "Over") current.over = dec;
        if (sel.label === "Under") current.under = dec;
        grouped.set(sel.points, current);
    }
    return grouped;
};

const linesFromGroupedPoints = (grouped: Map<number, { over?: number; under?: number }>): TeamGoalLine[] => {
    const lines: TeamGoalLine[] = [];
    for (const [point, pair] of grouped.entries()) {
        let pOver: number | undefined;
        if (pair.over && pair.under) {
            [pOver] = deVigTwoWay(pair.over, pair.under);
        } else if (pair.over) {
            pOver = toProbability(pair.over);
        } else if (pair.under) {
            pOver = 1 - toProbability(pair.under);
        }

        if (pOver !== undefined) lines.push({ point, pOver });
    }

    return lines.sort((a, b) => a.point - b.point);
};

const poissonPmf = (mean: number, maxGoals: number): number[] => {
    const pmf = new Array(maxGoals + 1).fill(0);
    pmf[0] = Math.exp(-mean);
    for (let g = 1; g <= maxGoals; g++) {
        pmf[g] = pmf[g - 1] * (mean / g);
    }

    let total = 0;
    for (const p of pmf) total += p;
    for (let g = 0; g <= maxGoals; g++) pmf[g] /= total;
    return pmf;
};

const probabilityOver = (pmf: number[], point: number): number => {
    const threshold = Math.floor(point) + 1;
    let p = 0;
    for (let g = threshold; g < pmf.length; g++) p += pmf[g];
    return p;
};

const compareJoint = (pmfA: number[], pmfB: number[]): { pAWin: number; pBWin: number; pTie: number } => {
    let pAWin = 0;
    let pBWin = 0;
    let pTie = 0;

    for (let a = 0; a < pmfA.length; a++) {
        for (let b = 0; b < pmfB.length; b++) {
            const p = pmfA[a] * pmfB[b];
            if (a > b) pAWin += p;
            else if (b > a) pBWin += p;
            else pTie += p;
        }
    }

    return { pAWin, pBWin, pTie };
};

const probabilityPucklineCover = (pmfTeam: number[], pmfOpp: number[], point: number): number => {
    let p = 0;
    for (let a = 0; a < pmfTeam.length; a++) {
        for (let b = 0; b < pmfOpp.length; b++) {
            if (a + point > b) p += pmfTeam[a] * pmfOpp[b];
        }
    }
    return p;
};

const parsePucklineSelections = (selections: DataSelection[]): Array<{ team: Team; point: number; pCover: number }> => {
    const parsed = selections
        .map((sel) => {
            const team = selectionTeam(sel);
            const point = sel.points;
            const dec = Number(sel.displayOdds?.decimal);
            if (!team || typeof point !== "number" || !Number.isFinite(dec) || dec <= 1) return null;
            return { team, point, dec };
        })
        .filter((v): v is { team: Team; point: number; dec: number } => v !== null);

    const used = new Array(parsed.length).fill(false);
    const result: Array<{ team: Team; point: number; pCover: number }> = [];

    for (let i = 0; i < parsed.length; i++) {
        if (used[i]) continue;
        const a = parsed[i];
        let pairIndex = -1;
        for (let j = i + 1; j < parsed.length; j++) {
            if (used[j]) continue;
            const b = parsed[j];
            if (Math.abs(a.point + b.point) < 1e-9) {
                pairIndex = j;
                break;
            }
        }

        if (pairIndex === -1) {
            result.push({ team: a.team, point: a.point, pCover: toProbability(a.dec) });
            used[i] = true;
            continue;
        }

        const b = parsed[pairIndex];
        const [pA, pB] = deVigTwoWay(a.dec, b.dec);
        result.push({ team: a.team, point: a.point, pCover: pA });
        result.push({ team: b.team, point: b.point, pCover: pB });
        used[i] = true;
        used[pairIndex] = true;
    }

    return result;
};

const logit = (p: number): number => {
    const q = Math.max(1e-9, Math.min(1 - 1e-9, p));
    return Math.log(q / (1 - q));
};

const fitEventMeans = (event: GameEventModel): FitResult | null => {
    if (event.teams.length !== 2) return null;
    const [teamA, teamB] = event.teams;

    const teamALines = event.teamLines.get(teamA) ?? [];
    const teamBLines = event.teamLines.get(teamB) ?? [];
    const constraintCount =
        teamALines.length +
        teamBLines.length +
        event.gameTotals.length +
        event.moneyline.size +
        event.puckline.length;
    if (constraintCount === 0) return null;

    let bestA = 2;
    let bestB = 2;
    let bestLoss = Number.POSITIVE_INFINITY;

    const score = (muA: number, muB: number): number => {
        const pmfA = poissonPmf(muA, 20);
        const pmfB = poissonPmf(muB, 20);
        const pmfTotal = poissonPmf(muA + muB, 30);
        const cmp = compareJoint(pmfA, pmfB);
        const pNoTie = 1 - cmp.pTie;
        const pAWinNoTie = cmp.pAWin / pNoTie;
        const pBWinNoTie = cmp.pBWin / pNoTie;

        let loss = 0;

        for (const line of teamALines) {
            const model = probabilityOver(pmfA, line.point);
            const diff = logit(model) - logit(line.pOver);
            loss += diff * diff;
        }

        for (const line of teamBLines) {
            const model = probabilityOver(pmfB, line.point);
            const diff = logit(model) - logit(line.pOver);
            loss += diff * diff;
        }

        for (const line of event.gameTotals) {
            const model = probabilityOver(pmfTotal, line.point);
            const diff = logit(model) - logit(line.pOver);
            loss += diff * diff;
        }

        const targetAWin = event.moneyline.get(teamA);
        if (targetAWin !== undefined) {
            const diff = logit(pAWinNoTie) - logit(targetAWin);
            loss += diff * diff;
        }

        const targetBWin = event.moneyline.get(teamB);
        if (targetBWin !== undefined) {
            const diff = logit(pBWinNoTie) - logit(targetBWin);
            loss += diff * diff;
        }

        for (const line of event.puckline) {
            const model =
                line.team === teamA
                    ? probabilityPucklineCover(pmfA, pmfB, line.point)
                    : probabilityPucklineCover(pmfB, pmfA, line.point);
            const diff = logit(model) - logit(line.pCover);
            loss += diff * diff;
        }

        return loss;
    };

    for (let muA = 0.1; muA <= 8; muA += 0.05) {
        for (let muB = 0.1; muB <= 8; muB += 0.05) {
            const loss = score(muA, muB);
            if (loss < bestLoss) {
                bestLoss = loss;
                bestA = muA;
                bestB = muB;
            }
        }
    }

    const aStart = Math.max(0.01, bestA - 0.08);
    const aEnd = bestA + 0.08;
    const bStart = Math.max(0.01, bestB - 0.08);
    const bEnd = bestB + 0.08;
    for (let muA = aStart; muA <= aEnd; muA += 0.002) {
        for (let muB = bStart; muB <= bEnd; muB += 0.002) {
            const loss = score(muA, muB);
            if (loss < bestLoss) {
                bestLoss = loss;
                bestA = muA;
                bestB = muB;
            }
        }
    }

    return {
        teamMeans: new Map<Team, number>([
            [teamA, bestA],
            [teamB, bestB],
        ]),
        gameMean: bestA + bestB,
    };
};

const extractEventTeams = (eventName: string): Team[] => {
    const split = eventName.split(" @ ");
    if (split.length !== 2) return [];

    const away = extractTeam(split[0]);
    const home = extractTeam(split[1]);
    if (!away || !home) return [];
    return [away, home];
};

const buildEventModels = (gameData: FeedData, teamData: FeedData): Map<string, GameEventModel> => {
    const today = new Date().toDateString();
    const todayEvents = new Map<string, EventData>();
    for (const event of gameData.events) {
        if (new Date(event.startEventDate).toDateString() === today) {
            todayEvents.set(event.id, event);
        }
    }

    const models = new Map<string, GameEventModel>();
    for (const [eventId, event] of todayEvents.entries()) {
        models.set(eventId, {
            eventId,
            teams: extractEventTeams(event.name),
            teamLines: new Map<Team, TeamGoalLine[]>(),
            gameTotals: [],
            moneyline: new Map<Team, number>(),
            puckline: [],
        });
    }

    const gameSelectionsByMarket = new Map<string, DataSelection[]>();
    for (const selection of gameData.selections) {
        const list = gameSelectionsByMarket.get(selection.marketId) ?? [];
        list.push(selection);
        gameSelectionsByMarket.set(selection.marketId, list);
    }

    for (const market of gameData.markets) {
        const model = models.get(market.eventId);
        if (!model) continue;
        const selections = gameSelectionsByMarket.get(market.id) ?? [];
        if (selections.length === 0) continue;

        const name = marketName(market);
        if (name.includes("total")) {
            model.gameTotals.push(...linesFromGroupedPoints(groupByPoints(selections)));
            continue;
        }

        if (name.includes("moneyline")) {
            const valid = selections
                .map((sel) => {
                    const team = selectionTeam(sel);
                    const dec = Number(sel.displayOdds?.decimal);
                    if (!team || !Number.isFinite(dec) || dec <= 1) return null;
                    return { team, dec };
                })
                .filter((v): v is { team: Team; dec: number } => v !== null);

            if (valid.length === 2) {
                const [pA, pB] = deVigTwoWay(valid[0].dec, valid[1].dec);
                model.moneyline.set(valid[0].team, pA);
                model.moneyline.set(valid[1].team, pB);
            }
            continue;
        }

        if (name.includes("puck line") || name.includes("puckline")) {
            model.puckline.push(...parsePucklineSelections(selections));
        }
    }

    const teamSelectionsByMarket = new Map<string, DataSelection[]>();
    for (const selection of teamData.selections) {
        const list = teamSelectionsByMarket.get(selection.marketId) ?? [];
        list.push(selection);
        teamSelectionsByMarket.set(selection.marketId, list);
    }

    for (const market of teamData.markets) {
        const model = models.get(market.eventId);
        if (!model) continue;
        const selections = teamSelectionsByMarket.get(market.id) ?? [];
        if (selections.length === 0) continue;

        const team = selectionTeam(selections[0]);
        if (!team) continue;

        const lines = linesFromGroupedPoints(groupByPoints(selections));
        if (lines.length === 0) continue;
        model.teamLines.set(team, lines);
    }

    return models;
};

async function getTeamOdds() {
    const fetchFeedData = async (url: string, feedName: string): Promise<FeedData> => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${feedName}: HTTP ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("application/json")) {
            throw new Error(`Failed to fetch ${feedName}: expected JSON response, got '${contentType || "unknown"}'`);
        }

        return await response.json() as FeedData;
    };

    const gameURL = "https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=42133&eventsQuery=%24filter%3DleagueId%20eq%20%2742133%27%20AND%20clientMetadata%2FSubcategories%2Fany%28s%3A%20s%2FId%20eq%20%274525%27%29&marketsQuery=%24filter%3DclientMetadata%2FsubCategoryId%20eq%20%274525%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&include=Events&entity=events";
    const teamURL = "https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=42133&eventsQuery=%24filter%3DleagueId%20eq%20%2742133%27%20AND%20clientMetadata%2FSubcategories%2Fany%28s%3A%20s%2FId%20eq%20%2716716%27%29&marketsQuery=%24filter%3DclientMetadata%2FsubCategoryId%20eq%20%2716716%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&include=Events&entity=events";
    const [gameData, teamData] = await Promise.all([
        fetchFeedData(gameURL, "game markets feed"),
        fetchFeedData(teamURL, "team totals feed"),
    ]);
    return { gameData, teamData };
}

export async function getTeamTotals(): Promise<Map<Team, number>> {
    const { gameData, teamData } = await getTeamOdds();
    const models = buildEventModels(gameData, teamData);
    const teamTotals: Map<Team, number> = new Map();

    for (const model of models.values()) {
        const fit = fitEventMeans(model);
        if (!fit) {
            for (const [team, lines] of model.teamLines.entries()) {
                const fallback = expectedGoalsFromLines(lines);
                if (fallback !== null) teamTotals.set(team, fallback);
            }
            continue;
        }

        for (const [team, mean] of fit.teamMeans.entries()) {
            teamTotals.set(team, mean);
        }
    }
    return teamTotals;
}
