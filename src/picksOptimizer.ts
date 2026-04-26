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
    points: number
    hits: number
    constructor(hit1: boolean, hit2: boolean, hit3: boolean) {
        this.least1 = hit1 || hit2 || hit3;
        const hitCount = (hit1 ? 1 : 0) + (hit2 ? 1 : 0) + (hit3 ? 1 : 0);
        this.points = hitCount === 0 ? 0 : hitCount === 1 ? 25 : hitCount === 2 ? 50 : 100;
        this.hits = hitCount;
    }
}

interface Total {
    least1: number;
    points: number;
    hits: number;
    count: number;
}
class ResultTotal implements Total {
    least1: number
    points: number
    hits: number
    count: number
    constructor() {
        this.least1 = 0;
        this.points = 0;
        this.hits = 0;
        this.count = 0;
    }
    add(result: Result) {
        if (result.least1) this.least1++;
        this.points += result.points;
        this.hits += result.hits;
        this.count++;
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

export const runSimulation = async (iterations: number) => {
    const response = await fetch('./history/history.json');
    const data = await response.json();

    class PickIndex {
        readonly slotTotal: number;
        readonly slotIndex: number;
        readonly gameCount: number;
        constructor(slotTotal: number, slotIndex: number, gameCount: number) {
            this.slotTotal = slotTotal;
            this.slotIndex = slotIndex;
            this.gameCount = gameCount;
        }
    }
    const codeForIndex = (slotTotal: number, slotIndex: number, gameCount: number) => {
        return `${slotTotal} ${slotIndex} ${gameCount}`;
    }
    const indexes: Map<string, PickIndex> = new Map();

    class GameResult {
        randomResults = new ResultTotal();
        strategyResults: Map<strategyPattern, ResultTotal> = new Map();

        gameDay: string;
        picksCount = 0;

        constructor(date: string) {
            this.gameDay = date;
            for (const strategy of allStrategies) {
                this.strategyResults.set(strategy, new ResultTotal());
            }
        }
    }

    const gameResults: Map<PickIndex, GameResult> = new Map();

    for (const item of data) {
        // if (item.format !== 'regular') continue;
        for (const file of item.files) {
            const response = await fetch(`./history/${file}`);
            const fileData = await response.json();

            const slotTotal = fileData.availableTimes.length;
            for (let slotIndex = 0; slotIndex < slotTotal; slotIndex++) {
                const availableTime = fileData.availableTimes[slotIndex];

                const set1: Map<number, HistoryPlayer> = new Map();
                const set2: Map<number, HistoryPlayer> = new Map();
                const set3: Map<number, HistoryPlayer> = new Map();
                const teams = new Set<string>();
                let gameCount = 0;
                for (const playerList of fileData.playerLists) {
                    const set = playerList.id === 1 ? set1 : playerList.id === 2 ? set2 : set3;
                    for (const player of playerList.players) {
                        const playsAtTime = player.availableTimes.includes(availableTime);
                        if (!playsAtTime) continue;

                        set.set(player.nhlPlayerId, player);
                        if (!teams.has(player.team)) {
                            gameCount++;
                            teams.add(player.team);
                            teams.add(player.opponent);
                        }
                    }
                }

                if (set1.size === 0 || set2.size === 0 || set3.size === 0) continue;

                const indexKey = codeForIndex(slotTotal, slotIndex, gameCount);
                let index = indexes.get(indexKey);
                if (!index) {
                    index = new PickIndex(slotTotal, slotIndex, gameCount);
                    indexes.set(indexKey, index);
                }
                let gameResult = gameResults.get(index);
                if (!gameResult) {
                    gameResult = new GameResult(fileData.date);
                    gameResults.set(index, gameResult);
                }
                gameResult.picksCount++;

                const array1 = Array.from(set1.values());
                const array2 = Array.from(set2.values());
                const array3 = Array.from(set3.values());

                for (let i = 0; i < iterations; i++) {
                    const resultRandom = simulateRandom(array1, array2, array3);
                    if (resultRandom !== null) gameResult.randomResults.add(resultRandom);
                    for (const [type, strategy] of gameResult.strategyResults) {
                        const result = simulateCombo(array1, array2, array3, type);
                        if (result !== null) strategy.add(result);
                    }
                }
            }
        }
    }

    const compile = () => {
        const results = [];
        for (const [index, result] of gameResults) {
            const totals = {} as Record<strategyPattern | 'random', Total>;
            totals.random = { ...result.randomResults };
            for (const [type, strategy] of result.strategyResults) {
                totals[type] = { ...strategy };
            }

            results.push({
                totals,
                ...index,
                gameDay: result.gameDay,
                picksCount: result.picksCount
            });
        }
        return results;
    }

    return compile();
}
