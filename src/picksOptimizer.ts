import type { Team } from './components/logo';

export interface Pick {
    name: string;
    prob: number;
    team: Team;
    gameId: string;
}

// NHL Picks Optimizer
// Inputs:
// picks1, picks2, picks3 = arrays of Pick
//
// Output:
// optimal picks for:
// - streak (maximize P(≥1 hit))
// - points (maximize expected value)
// - leaderboard (maximize P(all 3 hit))
// - hybrid (balanced blend of P(2 hits) and P(≥1 hit), constrained to 2+1 team pattern)
// + threshold relative to baseline top picks

type StrategyKey = 'streak' | 'points' | 'leaderboard' | 'hybrid';

interface EvalResult {
    pAtLeast1: number;
    p1hit: number;
    p2hit: number;
    p3hit: number;
    ev: number;
}

interface ComboResult extends EvalResult {
    p1: Pick;
    p2: Pick;
    p3: Pick;
}

interface ComboRatios {
    r1: number;
    r2: number;
    r3: number;
    productRatio: number;
    missRatio: number;
}

interface ComboSummary extends ComboResult {
    score: number;
    scoreLiftPct: number;
    ratios: ComboRatios;
}

interface StrategyThreshold {
    isBetterThanTopPicks: boolean;
    baselineScore: number;
    comboScore: number;
    scoreLiftPct: number;
    maxDropPctToBaseline: number;
    pick1MaxDropPct: number;
    pick2MaxDropPct: number;
    pick3MaxDropPct: number;
}

interface StrategyResult {
    topCombo: ComboSummary | null;
    top3Combos: ComboSummary[];
    tiedBestCombos: ComboSummary[];
    threshold: StrategyThreshold;
}

export interface OptimizePicksResult {
    baseline: ComboResult;
    streak: StrategyResult;
    points: StrategyResult;
    leaderboard: StrategyResult;
    hybrid: StrategyResult;
}

export function optimizePicks(picks1: Pick[], picks2: Pick[], picks3: Pick[]): OptimizePicksResult {

    const sameTeam = (a: Pick, b: Pick) => a.team === b.team;
    const sameGame = (a: Pick, b: Pick) => a.gameId === b.gameId;

    function pairCorr(a: Pick, b: Pick): number {
        if (sameTeam(a, b)) return 1.15;
        if (sameGame(a, b)) return 0.90;
        return 1.0;
    }

    const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

    function evaluate(p1: Pick, p2: Pick, p3: Pick): EvalResult {
        const pA = p1.prob;
        const pB = p2.prob;
        const pC = p3.prob;

        const cAB = pairCorr(p1, p2);
        const cAC = pairCorr(p1, p3);
        const cBC = pairCorr(p2, p3);

        // Correlated pairwise joints, clamped to valid probability range.
        const pAB = clamp01(Math.min(pA * pB * cAB, Math.min(pA, pB)));
        const pAC = clamp01(Math.min(pA * pC * cAC, Math.min(pA, pC)));
        const pBC = clamp01(Math.min(pB * pC * cBC, Math.min(pB, pC)));

        // Triple joint: multiply pairwise correlations (stacking compounds)
        const pABC = clamp01(Math.min(pA * pB * pC * cAB * cAC * cBC, Math.min(pAB, pAC, pBC)));

        // Inclusion-exclusion
        const pAtLeast1 = clamp01(pA + pB + pC - pAB - pAC - pBC + pABC);
        const p3hit = clamp01(pABC);
        const p2hit = clamp01((pAB + pAC + pBC) - 3 * pABC);
        const p1hit = clamp01(pAtLeast1 - p2hit - p3hit);

        // EV = 25 * P(≥1) + 25 * P(≥2) + 50 * P(all 3)
        const ev = 25 * p1hit + 50 * p2hit + 100 * p3hit;

        return { pAtLeast1, p1hit, p2hit, p3hit, ev };
    }

    const top1 = picks1.reduce((a, b) => a.prob > b.prob ? a : b);
    const top2 = picks2.reduce((a, b) => a.prob > b.prob ? a : b);
    const top3 = picks3.reduce((a, b) => a.prob > b.prob ? a : b);

    const baseline: ComboResult = { p1: top1, p2: top2, p3: top3, ...evaluate(top1, top2, top3) };

    function isHybrid(p1: Pick, p2: Pick, p3: Pick): boolean {
        const pairs = [[p1, p2], [p1, p3], [p2, p3]];
        const sameTeamCount = pairs.filter(([a, b]) => sameTeam(a, b)).length;
        return sameTeamCount === 1;
    }

    let bestStreak: ComboResult[] = [];
    let bestPoints: ComboResult[] = [];
    let bestLeaderboard: ComboResult[] = [];
    let bestHybrid: ComboResult[] = [];

    let bestStreakVal = -Infinity;
    let bestPointsVal = -Infinity;
    let bestLeaderboardVal = -Infinity;
    let bestHybridVal = -Infinity;

    const top3Streak: ComboResult[] = [];
    const top3Points: ComboResult[] = [];
    const top3Leaderboard: ComboResult[] = [];
    const top3Hybrid: ComboResult[] = [];

    const strategyScore = (strategy: StrategyKey, combo: EvalResult): number => {
        switch (strategy) {
            case 'streak':
                return combo.pAtLeast1;
            case 'leaderboard':
                return combo.p3hit;
            case 'points':
                return combo.ev;
            case 'hybrid':
                return (0.6 * combo.p2hit) + (0.4 * combo.pAtLeast1);
        }
    };

    const computeRatios = (combo: ComboResult): ComboRatios => {
        const r1 = combo.p1.prob / top1.prob;
        const r2 = combo.p2.prob / top2.prob;
        const r3 = combo.p3.prob / top3.prob;
        const productRatio = r1 * r2 * r3;

        const baseMiss = (1 - top1.prob) * (1 - top2.prob) * (1 - top3.prob);
        const altMiss = (1 - combo.p1.prob) * (1 - combo.p2.prob) * (1 - combo.p3.prob);
        const missRatio = baseMiss === 0 ? 0 : altMiss / baseMiss;

        return { r1, r2, r3, productRatio, missRatio };
    };

    const updateTop3 = (list: ComboResult[], combo: ComboResult, strategy: StrategyKey): void => {
        list.push(combo);
        list.sort((a, b) => strategyScore(strategy, b) - strategyScore(strategy, a));
        if (list.length > 3) list.length = 3;
    };

    const EPS = 1e-6;

    for (const p1 of picks1) {
        for (const p2 of picks2) {
            for (const p3 of picks3) {

                const res = evaluate(p1, p2, p3);
                const combo: ComboResult = { p1, p2, p3, ...res };

                updateTop3(top3Streak, combo, 'streak');
                updateTop3(top3Points, combo, 'points');
                updateTop3(top3Leaderboard, combo, 'leaderboard');

                // --- STREAK ---
                if (res.pAtLeast1 > bestStreakVal + EPS) {
                    bestStreakVal = res.pAtLeast1;
                    bestStreak = [combo];
                } else if (Math.abs(res.pAtLeast1 - bestStreakVal) <= EPS) {
                    bestStreak.push(combo);
                }

                // --- POINTS ---
                if (res.ev > bestPointsVal + EPS) {
                    bestPointsVal = res.ev;
                    bestPoints = [combo];
                } else if (Math.abs(res.ev - bestPointsVal) <= EPS) {
                    bestPoints.push(combo);
                }

                // --- LEADERBOARD ---
                if (res.p3hit > bestLeaderboardVal + EPS) {
                    bestLeaderboardVal = res.p3hit;
                    bestLeaderboard = [combo];
                } else if (Math.abs(res.p3hit - bestLeaderboardVal) <= EPS) {
                    bestLeaderboard.push(combo);
                }

                // --- HYBRID ---
                if (isHybrid(p1, p2, p3)) {
                    updateTop3(top3Hybrid, combo, 'hybrid');
                    const hybridScore = strategyScore('hybrid', combo);
                    if (hybridScore > bestHybridVal + EPS) {
                        bestHybridVal = hybridScore;
                        bestHybrid = [combo];
                    } else if (Math.abs(hybridScore - bestHybridVal) <= EPS) {
                        bestHybrid.push(combo);
                    }
                }
            }
        }
    }

    const baselineScores: Record<StrategyKey, number> = {
        streak: strategyScore('streak', baseline),
        points: strategyScore('points', baseline),
        leaderboard: strategyScore('leaderboard', baseline),
        hybrid: strategyScore('hybrid', baseline),
    };

    const makeComboSummary = (strategy: StrategyKey, combo: ComboResult): ComboSummary => {
        const baselineScore = baselineScores[strategy];
        const score = strategyScore(strategy, combo);
        return {
            ...combo,
            score,
            scoreLiftPct: baselineScore === 0 ? 0 : ((score / baselineScore) - 1) * 100,
            ratios: computeRatios(combo),
        };
    };

    // Threshold: max score drop before strategy becomes worse than baseline top picks.
    function computeThreshold(strategy: StrategyKey, combo: ComboResult): StrategyThreshold {
        const baselineScore = baselineScores[strategy];
        const comboScore = strategyScore(strategy, combo);
        const isBetterThanTopPicks = comboScore > baselineScore;
        const maxDropPctToBaseline = comboScore <= baselineScore || comboScore === 0
            ? 0
            : (1 - (baselineScore / comboScore)) * 100;

        const maxSinglePickDropPct = (pickIndex: 1 | 2 | 3): number => {
            if (comboScore <= baselineScore || comboScore === 0) return 0;

            const scoreAtDrop = (dropPct: number): number => {
                const factor = Math.max(0, 1 - dropPct / 100);
                const d1 = pickIndex === 1 ? { ...combo.p1, prob: combo.p1.prob * factor } : combo.p1;
                const d2 = pickIndex === 2 ? { ...combo.p2, prob: combo.p2.prob * factor } : combo.p2;
                const d3 = pickIndex === 3 ? { ...combo.p3, prob: combo.p3.prob * factor } : combo.p3;
                return strategyScore(strategy, evaluate(d1, d2, d3));
            };

            let low = 0;
            let high = 100;
            for (let i = 0; i < 32; i++) {
                const mid = (low + high) / 2;
                if (scoreAtDrop(mid) >= baselineScore) {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            return low;
        };

        const pick1MaxDropPct = maxSinglePickDropPct(1);
        const pick2MaxDropPct = maxSinglePickDropPct(2);
        const pick3MaxDropPct = maxSinglePickDropPct(3);

        return {
            isBetterThanTopPicks,
            baselineScore,
            comboScore,
            scoreLiftPct: baselineScore === 0 ? 0 : ((comboScore / baselineScore) - 1) * 100,
            maxDropPctToBaseline,
            pick1MaxDropPct,
            pick2MaxDropPct,
            pick3MaxDropPct,
        };
    }

    const zeroThreshold: StrategyThreshold = {
        isBetterThanTopPicks: false,
        baselineScore: 0,
        comboScore: 0,
        scoreLiftPct: 0,
        maxDropPctToBaseline: 0,
        pick1MaxDropPct: 0,
        pick2MaxDropPct: 0,
        pick3MaxDropPct: 0,
    };

    const buildResult = (strategy: StrategyKey, tiedBest: ComboResult[], top3: ComboResult[]): StrategyResult => {
        const topCombo = top3.length > 0 ? makeComboSummary(strategy, top3[0]) : null;
        return {
            topCombo,
            top3Combos: top3.map((combo) => makeComboSummary(strategy, combo)),
            tiedBestCombos: tiedBest.map((combo) => makeComboSummary(strategy, combo)),
            threshold: tiedBest.length > 0 ? computeThreshold(strategy, tiedBest[0]) : zeroThreshold,
        };
    };

    return {
        baseline,
        streak: buildResult('streak', bestStreak, top3Streak),
        points: buildResult('points', bestPoints, top3Points),
        leaderboard: buildResult('leaderboard', bestLeaderboard, top3Leaderboard),
        hybrid: buildResult('hybrid', bestHybrid, top3Hybrid),
    };
}

/* 
{
    const gamesMap = new Map<Team, string>();
    for (const game of gamesList) {
        const gameName = `${game.away.code} @ ${game.home.code}`;
        gamesMap.set(game.home.code, gameName);
        gamesMap.set(game.away.code, gameName);
    }

    const mod = (players: Picks.PickOdds[]): Pick[] => {
        return players.filter((item) => item.player.betAvg).map(
            (item: Picks.PickOdds): Pick => {
                const player = item.player;
                return {
                    name: player.fullName,
                    prob: player.betAvg ?? 0,
                    team: player.team.code,
                    gameId: gamesMap.get(player.team.code) ?? player.team.code,
                };
            }
        )
    };
    const p1 = mod(table1Rows);
    const p2 = mod(table2Rows);
    const p3 = mod(table3Rows);
    console.log(optimizePicks(p1, p2, p3));
}
*/

interface HistoryPlayer {
    "nhlPlayerId": number;
    "fullName": string;
    "team": string;
    "opponent": string;
    "scored": boolean;
    "note": string;
    "availableTimes": string[];
}

type PlayerSet = Array<HistoryPlayer>;
function getRandomEntry(entries: PlayerSet = []): HistoryPlayer | undefined {
    const randomEntry = entries[Math.floor(Math.random() * entries.length)];
    return randomEntry;
}

class Result {
    least1: boolean
    all3: boolean
    hits: number
    points: number
    constructor(hit1: boolean, hit2: boolean, hit3: boolean) {
        this.least1 = hit1 || hit2 || hit3;
        this.all3 = hit1 && hit2 && hit3;
        const hitCount = (hit1 ? 1 : 0) + (hit2 ? 1 : 0) + (hit3 ? 1 : 0);
        this.hits = hitCount;
        this.points = hitCount === 0 ? 0 : hitCount === 1 ? 25 : hitCount === 2 ? 50 : 100;
    }
}
class ResultTotal {
    title: string
    least1: number
    all3: number
    hits: number
    points: number
    count: number
    constructor(title: string) {
        this.title = title;
        this.least1 = 0;
        this.all3 = 0;
        this.hits = 0;
        this.points = 0;
        this.count = 0;
    }
    add(result: Result) {
        if (result.least1) this.least1++;
        if (result.all3) this.all3++;
        this.hits += result.hits;
        this.points += result.points;
        this.count++;
    }
    getTotal() {
        return {
            count: this.count,
            title: this.title,
            least1: this.least1 / this.count,
            all3: this.all3 / this.count,
            hitsAvg: this.hits / this.count,
            pointsAvg: this.points / this.count,
        };
    }
}
const simulateRandom = (set1: PlayerSet, set2: PlayerSet, set3: PlayerSet): Result | null => {
    const pick1 = getRandomEntry(set1);
    if (!pick1) return null;
    const pick2 = getRandomEntry(set2);
    if (!pick2) return null;
    const pick3 = getRandomEntry(set3);
    if (!pick3) return null;
    return new Result(pick1.scored, pick2.scored, pick3.scored);
}
function getIndependentSet(player: HistoryPlayer, set: PlayerSet): PlayerSet {
    const independent = set.filter((p) => p.team !== player.team && p.opponent !== player.team);
    return independent;
}
const simulateIndependent = (set1: PlayerSet, set2: PlayerSet, set3: PlayerSet): Result | null => {
    const pick1 = getRandomEntry(set1);
    if (!pick1) return null;
    const independent2 = getIndependentSet(pick1, set2);
    const pick2 = getRandomEntry(independent2);
    if (!pick2) return null;
    const independent3 = getIndependentSet(pick2, getIndependentSet(pick1, set3));
    const pick3 = getRandomEntry(independent3);
    if (!pick3) return null;
    return new Result(pick1.scored, pick2.scored, pick3.scored);

}
function getStackedSet(player: HistoryPlayer, set: PlayerSet): PlayerSet {
    const stacked = set.filter((p) => p.team === player.team);
    return stacked;
}
const simulateStacked = (set1: PlayerSet, set2: PlayerSet, set3: PlayerSet): Result | null => {
    const pick1 = getRandomEntry(set1);
    if (!pick1) return null;
    const stacked2 = getStackedSet(pick1, set2);
    const pick2 = getRandomEntry(stacked2);
    if (!pick2) return null;
    const stacked3 = getStackedSet(pick2, getStackedSet(pick1, set3));
    const pick3 = getRandomEntry(stacked3);
    if (!pick3) return null;
    return new Result(pick1.scored, pick2.scored, pick3.scored);

}
function getOpposingSet(player: HistoryPlayer, set: PlayerSet): PlayerSet {
    const opposing = set.filter((p) => p.team === player.opponent);
    return opposing;
}
const simulateOpposing = (set1: PlayerSet, set2: PlayerSet, set3: PlayerSet): Result | null => {
    const pick1 = getRandomEntry(set1);
    if (!pick1) return null;
    const opposing2 = getOpposingSet(pick1, set2);
    const pick2 = getRandomEntry(opposing2);
    if (!pick2) return null;
    const independent3 = getIndependentSet(pick2, getIndependentSet(pick1, set3));
    const pick3 = getRandomEntry(independent3);
    if (!pick3) return null;
    return new Result(pick1.scored, pick2.scored, pick3.scored);

}

/*
    sss = stacked
    iii = independent
    sso = stacked + opposing - s vs o order
    ssi = stacked + independent - s vs i order
    ooi = opposing - i vs o order
    # of games
*/
export const runSimulation = async () => {
    const ITERATIONS_PER_FILE = 10000;
    const response = await fetch('./history/history.json');
    const data = await response.json();
    const randomResults = new ResultTotal("Random");
    const independentResults = new ResultTotal("Independent");
    const opposingResults = new ResultTotal("Opposing");
    const stackedResults = new ResultTotal("Stacked");
    let totalCount = 0;
    for (const item of data) {
        if (item.format !== 'regular') continue;
        for (const file of item.files) {
            const response = await fetch(`./history/${file}`);
            const fileData = await response.json();
            const set1: Map<number, HistoryPlayer> = new Map();
            const set2: Map<number, HistoryPlayer> = new Map();
            const set3: Map<number, HistoryPlayer> = new Map();
            const teams = new Set<string>();
            let gameCount = 0;
            for (const playerList of fileData.playerLists) {
                const set = playerList.id === 1 ? set1 : playerList.id === 2 ? set2 : set3;
                for (const player of playerList.players) {
                    set.set(player.nhlPlayerId, player);
                    if (!teams.has(player.team)) {
                        gameCount++;
                        teams.add(player.team);
                        teams.add(player.opponent);
                    }
                }
            }
            if (gameCount !== 1) continue;
            if (set1.size === 0 || set2.size === 0 || set3.size === 0) continue;
            const array1 = Array.from(set1.values());
            const array2 = Array.from(set2.values());
            const array3 = Array.from(set3.values());

            for (let i = 0; i < ITERATIONS_PER_FILE; i++) {
                const resultRandom = simulateRandom(array1, array2, array3);
                if (resultRandom !== null) randomResults.add(resultRandom);
                const resultIndependent = simulateIndependent(array1, array2, array3);
                if (resultIndependent !== null) independentResults.add(resultIndependent);
                const resultStacked = simulateStacked(array1, array2, array3);
                if (resultStacked !== null) stackedResults.add(resultStacked);
                const resultOpposing = simulateOpposing(array1, array2, array3);
                if (resultOpposing !== null) opposingResults.add(resultOpposing);
                totalCount++;
            }
        }
    }
    if (totalCount > 0) {
        const rand = randomResults.getTotal();
        const ind = independentResults.getTotal();
        const opp = opposingResults.getTotal();
        const stack = stackedResults.getTotal();

        // Correlation factors for each goal
        const corr = {
            all3: {
                sameTeam: (rand.all3 && stack.all3) ? stack.all3 / rand.all3 : null,
                opposing: (rand.all3 && opp.all3) ? opp.all3 / rand.all3 : null,
                independent: (rand.all3 && ind.all3) ? ind.all3 / rand.all3 : null
            },
            least1: {
                sameTeam: (rand.least1 && stack.least1) ? stack.least1 / rand.least1 : null,
                opposing: (rand.least1 && opp.least1) ? opp.least1 / rand.least1 : null,
                independent: (rand.least1 && ind.least1) ? ind.least1 / rand.least1 : null
            },
            hitsAvg: {
                sameTeam: (rand.hitsAvg && stack.hitsAvg) ? stack.hitsAvg / rand.hitsAvg : null,
                opposing: (rand.hitsAvg && opp.hitsAvg) ? opp.hitsAvg / rand.hitsAvg : null,
                independent: (rand.hitsAvg && ind.hitsAvg) ? ind.hitsAvg / rand.hitsAvg : null
            },
            pointsAvg: {
                sameTeam: (rand.pointsAvg && stack.pointsAvg) ? stack.pointsAvg / rand.pointsAvg : null,
                opposing: (rand.pointsAvg && opp.pointsAvg) ? opp.pointsAvg / rand.pointsAvg : null,
                independent: (rand.pointsAvg && ind.pointsAvg) ? ind.pointsAvg / rand.pointsAvg : null
            }
        };

        // console.log(rand);
        // console.log(ind);
        // console.log(opp);
        // console.log(stack);

        console.log('--- Correlation Factors (relative to Independent) ---');
        console.log('All 3 hit:', corr.all3);
        console.log('At least 1 hit:', corr.least1);
        console.log('Average hits:', corr.hitsAvg);
        console.log('Average points:', corr.pointsAvg);

        return {
            independent: ind,
            opposing: opp,
            random: rand,
            stacked: stack,
            correlation: corr
        };
    }
}
