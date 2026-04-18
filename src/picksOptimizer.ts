import { allStrategies, type strategyPattern } from "./statsCalculations";

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
    points: number
    hits: number
    constructor(hit1: boolean, hit2: boolean, hit3: boolean) {
        this.least1 = hit1 || hit2 || hit3;
        this.all3 = hit1 && hit2 && hit3;
        const hitCount = (hit1 ? 1 : 0) + (hit2 ? 1 : 0) + (hit3 ? 1 : 0);
        this.points = hitCount === 0 ? 0 : hitCount === 1 ? 25 : hitCount === 2 ? 50 : 100;
        this.hits = hitCount;
    }
}
interface Total {
    count: number;
    title: string;
    least1: number;
    all3: number;
    points: number;
    hits: number;
}

class ResultTotal {
    title: string
    least1: number
    all3: number
    points: number
    hits: number
    count: number
    constructor(title: string) {
        this.title = title;
        this.least1 = 0;
        this.all3 = 0;
        this.points = 0;
        this.hits = 0;
        this.count = 0;
    }
    add(result: Result) {
        if (result.least1) this.least1++;
        if (result.all3) this.all3++;
        this.points += result.points;
        this.hits += result.hits;
        this.count++;
    }
    getTotal(): Total {
        return {
            count: this.count,
            title: this.title,
            least1: this.least1 / this.count,
            all3: this.all3 / this.count,
            points: this.points / this.count,
            hits: this.hits / this.count,
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
function iSet(player: HistoryPlayer, set: PlayerSet): PlayerSet {
    const independent = set.filter((p) => p.team !== player.team && p.opponent !== player.team);
    return independent;
}
function sSet(player: HistoryPlayer, set: PlayerSet): PlayerSet {
    const stacked = set.filter((p) => p.team === player.team);
    return stacked;
}
function oSet(player: HistoryPlayer, set: PlayerSet): PlayerSet {
    const opposing = set.filter((p) => p.team === player.opponent);
    return opposing;
}

/**
 * Simulate a pick combination according to the given strategy pattern.
 * @param set1 PlayerSet for pick 1
 * @param set2 PlayerSet for pick 2
 * @param set3 PlayerSet for pick 3
 * @param pattern strategyPattern string
 * @returns Result or null if a valid combo can't be formed
 */
function simulateCombo(set1: PlayerSet, set2: PlayerSet, set3: PlayerSet, pattern: strategyPattern): Result | null {
    const pick1 = getRandomEntry(set1);
    if (!pick1) return null;
    let pick2: HistoryPlayer | undefined;
    let pick3: HistoryPlayer | undefined;
    if (pattern === 'iii') {
        pick2 = getRandomEntry(iSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(iSet(pick2, iSet(pick1, set3)));
    } else if (pattern === 'sss') {
        pick2 = getRandomEntry(sSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(sSet(pick2, set3));
    } else if (pattern === 'iss') {
        pick2 = getRandomEntry(iSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(sSet(pick2, set3));
    } else if (pattern === 'sis') {
        pick2 = getRandomEntry(iSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(sSet(pick1, set3));
    } else if (pattern === 'ssi') {
        pick2 = getRandomEntry(sSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(iSet(pick1, set3));
    } else if (pattern === 'ioo') {
        pick2 = getRandomEntry(iSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(oSet(pick2, set3));
    } else if (pattern === 'oio') {
        pick2 = getRandomEntry(iSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(oSet(pick1, set3));
    } else if (pattern === 'ooi') {
        pick2 = getRandomEntry(oSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(iSet(pick1, set3));
    } else if (pattern === 'oso') {
        pick2 = getRandomEntry(sSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(oSet(pick1, set3));
    } else if (pattern === 'soo') {
        pick2 = getRandomEntry(sSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(oSet(pick2, set3));
    } else if (pattern === 'sos') {
        pick2 = getRandomEntry(oSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(sSet(pick1, set3));
    } else if (pattern === 'oss') {
        pick2 = getRandomEntry(oSet(pick1, set2));
        if (pick2) pick3 = getRandomEntry(sSet(pick2, set3));
    }
    if (!pick2) return null;
    if (!pick3) return null;
    return new Result(pick1.scored, pick2.scored, pick3.scored);
}

export const runSimulation = async (gamesCount: number, iterations: number) => {
    const response = await fetch('./history/history.json');
    const data = await response.json();
    class GameResults {
        gamesMin: number;
        gamesMax: number;

        randomResults = new ResultTotal("Random");
        strategyResults: Map<strategyPattern, ResultTotal> = new Map();

        nightsCount = 0;

        constructor(min: number = 0, max: number = Number.POSITIVE_INFINITY) {
            this.gamesMin = min;
            this.gamesMax = max;

            for (const strategy of allStrategies) {
                this.strategyResults.set(strategy, new ResultTotal(strategy));
            }
        }
    }
    const gameResults = gamesCount === 1 ? new GameResults(1, 1) : gamesCount === 2 ? new GameResults(2, 2) : new GameResults(3);

    for (const item of data) {
        // if (item.format !== 'regular') continue;
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

            if (gameResults.gamesMin > gameCount || gameResults.gamesMax < gameCount) continue;
            gameResults.nightsCount++;

            if (set1.size === 0 || set2.size === 0 || set3.size === 0) continue;
            const array1 = Array.from(set1.values());
            const array2 = Array.from(set2.values());
            const array3 = Array.from(set3.values());

            for (let i = 0; i < iterations; i++) {
                const resultRandom = simulateRandom(array1, array2, array3);
                if (resultRandom !== null) gameResults.randomResults.add(resultRandom);
                for (const [type, strategy] of gameResults.strategyResults) {
                    const result = simulateCombo(array1, array2, array3, type);
                    if (result !== null) strategy.add(result);
                }
            }
        }
    }

    const compile = (gameResults: GameResults, baseline: Total) => {
        const corr = {
            least1: {} as Record<strategyPattern, number | null>,
            all3: {} as Record<strategyPattern, number | null>,
            points: {} as Record<strategyPattern, number | null>,
            hits: {} as Record<strategyPattern, number | null>
        };

        const assign = (key: keyof typeof corr, type: strategyPattern, total: Total) => {
            const randVal = baseline[key];
            const totalVal = total[key];
            if (randVal && totalVal) {
                corr[key][type] = totalVal / randVal;
            } else {
                corr[key][type] = null;
            }
        }

        const totals = {} as Record<strategyPattern, Total>;
        for (const [type, strategy] of gameResults.strategyResults) {
            totals[type] = strategy.getTotal();
        }
        for (const [type, strategy] of gameResults.strategyResults) {
            const total = strategy.getTotal();
            assign('least1', type, total);
            assign('all3', type, total);
            assign('points', type, total);
            assign('hits', type, total);
        }

        console.log('--- Correlation Factors (relative to ' + baseline.title + ') ---');
        if (gameResults.gamesMin === gameResults.gamesMax) console.log(gameResults.gamesMin + ' Game Nights');
        else if (gameResults.gamesMax === Infinity) console.log(gameResults.gamesMin + '+ Game Nights');
        else console.log(gameResults.gamesMin + ' - ' + gameResults.gamesMax + ' Game Nights');
        console.log(gameResults.nightsCount + ' nights simulated');
        console.log(corr);

        return {
            gameResults: gameResults,
            correlation: corr
        };
    }

    const baseline = gamesCount >= 3 ? gameResults.strategyResults.get('iii')!.getTotal() : gameResults.randomResults.getTotal();
    return compile(gameResults, baseline);
}
