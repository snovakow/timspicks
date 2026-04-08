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

    let top3Streak: ComboResult[] = [];
    let top3Points: ComboResult[] = [];
    let top3Leaderboard: ComboResult[] = [];
    let top3Hybrid: ComboResult[] = [];

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
