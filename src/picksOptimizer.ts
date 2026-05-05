import * as Picks from "./components/Table";
import { deVig, oddsNameMap } from "./dataProcessor";
import type { strategyPattern, LogStatsKey, StrategyMode, Strategy } from "./sportsbookTypes";
import { allStrategies, SportsbookKeys, LogStatsKeys } from "./sportsbookTypes";

export const calcAny = (prob1: number, prob2: number, prob3: number): number => {
    return 1 - (1 - prob1) * (1 - prob2) * (1 - prob3);
};

export const calcPnt = (prob1: number, prob2: number, prob3: number): number => {
    const not1 = 1 - prob1;
    const not2 = 1 - prob2;
    const not3 = 1 - prob3;
    const p1 = prob1 * not2 * not3 + not1 * prob2 * not3 + not1 * not2 * prob3;
    const p2 = prob1 * prob2 * not3 + prob1 * not2 * prob3 + not1 * prob2 * prob3;
    const p3 = prob1 * prob2 * prob3;
    return p1 * 25 + p2 * 50 + p3 * 100;
};

export const calcHit = (prob1: number, prob2: number, prob3: number): number => {
    return prob1 + prob2 + prob3;
};

interface HistoryPlayer {
    "nhlPlayerId": number;
    "fullName": string;
    "team": string;
    "opponent": string;
    "scored": boolean;
    "note": string;
    "availableTimes": string[];
}

type CorrelationData = Record<typeof allStrategies[number], number | null>;
type CorrelationCount = Record<typeof allStrategies[number], number>;
type BaselineKey = 'random' | 'iii';

export interface CorrelationResult {
    least1: CorrelationData,
    points: CorrelationData,
    hits: CorrelationData,
};
export interface CorrelationResults {
    "1": CorrelationResult,
    "2": CorrelationResult,
    "3+": CorrelationResult,
};

class Correlation {
    strategy = {
        least1: {} as CorrelationData,
        points: {} as CorrelationData,
        hits: {} as CorrelationData,
        count: {} as CorrelationCount
    }
    baseline: Total = {
        least1: 0,
        points: 0,
        hits: 0,
        count: 0
    };
    baselineKey: BaselineKey;

    constructor(baselineKey: BaselineKey) {
        this.baselineKey = baselineKey;
        for (const combo of allStrategies) {
            this.strategy.least1[combo] = null;
            this.strategy.points[combo] = null;
            this.strategy.hits[combo] = null;
            this.strategy.count[combo] = 0;
        }
    }
    add(result: SimTotal) {
        for (const combo of allStrategies) {
            if (result[combo].count === 0) continue;
            if (this.strategy.least1[combo] === null) this.strategy.least1[combo] = 0;
            if (this.strategy.points[combo] === null) this.strategy.points[combo] = 0;
            if (this.strategy.hits[combo] === null) this.strategy.hits[combo] = 0;
            this.strategy.least1[combo] += result[combo].least1;
            this.strategy.points[combo] += result[combo].points;
            this.strategy.hits[combo] += result[combo].hits;
            this.strategy.count[combo] += result[combo].count;
        }

        this.baseline.least1 += result[this.baselineKey].least1;
        this.baseline.points += result[this.baselineKey].points;
        this.baseline.hits += result[this.baselineKey].hits;
        this.baseline.count += result[this.baselineKey].count;
    }
    calculate() {
        if (this.baseline.count === 0) return;

        this.baseline.least1 /= this.baseline.count;
        this.baseline.points /= this.baseline.count;
        this.baseline.hits /= this.baseline.count;

        for (const combo of allStrategies) {
            const count = this.strategy.count[combo];
            if (count === 0) continue;
            if (this.strategy.least1[combo] === null) this.strategy.least1[combo] = 0;
            if (this.strategy.points[combo] === null) this.strategy.points[combo] = 0;
            if (this.strategy.hits[combo] === null) this.strategy.hits[combo] = 0;
            this.strategy.least1[combo] /= count * this.baseline.least1;
            this.strategy.points[combo] /= count * this.baseline.points;
            this.strategy.hits[combo] /= count * this.baseline.hits;

            this.strategy.least1[combo] = Math.log(this.strategy.least1[combo]) + 1;
            this.strategy.points[combo] = Math.log(this.strategy.points[combo]) + 1;
            this.strategy.hits[combo] = Math.log(this.strategy.hits[combo]) + 1;
        }
    }
    results(): CorrelationResult {
        return {
            least1: this.strategy.least1,
            points: this.strategy.points,
            hits: this.strategy.hits,
        };
    }
};

export const correlations: CorrelationResults = {
    "1": {
        "least1": {
            "iii": null,
            "sss": 0.9952713158639847,
            "iss": null,
            "sis": null,
            "ssi": null,
            "ioo": null,
            "oio": null,
            "ooi": null,
            "oso": 0.9968607563202877,
            "soo": 0.9969121953573922,
            "sos": 1.0059792518125776,
            "oss": 0.9997726237454385
        },
        "points": {
            "iii": null,
            "sss": 0.9997978427155497,
            "iss": null,
            "sis": null,
            "ssi": null,
            "ioo": null,
            "oio": null,
            "ooi": null,
            "oso": 0.9971823234010139,
            "soo": 0.9971987740128077,
            "sos": 1.0000712909238518,
            "oss": 0.9973695978613997
        },
        "hits": {
            "iii": null,
            "sss": 0.999968929041933,
            "iss": null,
            "sis": null,
            "ssi": null,
            "ioo": null,
            "oio": null,
            "ooi": null,
            "oso": 0.9975397876871234,
            "soo": 0.9975579491369438,
            "sos": 1.0005667332202108,
            "oss": 0.9972716940625876
        }
    },
    "2": {
        "least1": {
            "iii": null,
            "sss": 0.9973448161970763,
            "iss": 0.9921977481686849,
            "sis": 0.9993338302714749,
            "ssi": 0.9909350603221198,
            "ioo": 0.9948792912454089,
            "oio": 0.9962420831136969,
            "ooi": 1.003054032608402,
            "oso": 0.9948468300614502,
            "soo": 0.9950155756606656,
            "sos": 1.0098922630200091,
            "oss": 1.0072746083288473
        },
        "points": {
            "iii": null,
            "sss": 1.0022054557129827,
            "iss": 0.9903528781670692,
            "sis": 1.0014856102087932,
            "ssi": 0.9947364827952582,
            "ioo": 0.991629746725105,
            "oio": 0.9929677992007679,
            "ooi": 0.9997323304641367,
            "oso": 0.9936284242630419,
            "soo": 0.9938176988628169,
            "sos": 1.0076513852596651,
            "oss": 0.9986698842838014
        },
        "hits": {
            "iii": null,
            "sss": 1.002139630047202,
            "iss": 0.9907664328274415,
            "sis": 1.0009545768086936,
            "ssi": 0.9946145620678143,
            "ioo": 0.9921487939596133,
            "oio": 0.9935466952380083,
            "ooi": 0.9997048809293316,
            "oso": 0.9947255162839707,
            "soo": 0.9949080132486099,
            "sos": 1.0074308684184743,
            "oss": 0.9994532747892344
        }
    },
    "3+": {
        "least1": {
            "iii": 1,
            "sss": 0.9960442243285105,
            "iss": 0.996558654369376,
            "sis": 0.995749417682109,
            "ssi": 0.9990153773210311,
            "ioo": 0.9969392003938472,
            "oio": 1.000493366280597,
            "ooi": 1.0096913487194108,
            "oso": 0.9990090518694602,
            "soo": 0.9990320844204282,
            "sos": 1.0084083707057592,
            "oss": 1.0053358022751429
        },
        "points": {
            "iii": 1,
            "sss": 0.9888477956814133,
            "iss": 0.9932110174050741,
            "sis": 0.9951795511787667,
            "ssi": 0.9958330458710244,
            "ioo": 0.9943741406469522,
            "oio": 0.9984557414025668,
            "ooi": 1.0092641355316305,
            "oso": 0.9949787437725824,
            "soo": 0.9950500015590041,
            "sos": 1.0039262025113742,
            "oss": 1.0002450562658138
        },
        "hits": {
            "iii": 1,
            "sss": 0.989614754632695,
            "iss": 0.9938478050344842,
            "sis": 0.9951753385519866,
            "ssi": 0.9961345472347511,
            "ioo": 0.9948314987127403,
            "oio": 0.9988696652027286,
            "ooi": 1.0089822759829932,
            "oso": 0.996092929834147,
            "soo": 0.9961612620668687,
            "sos": 1.00436597135487,
            "oss": 1.0010637691458937
        }
    }
};

const compileSimItems = (simItems: SimItem[]): CorrelationResults => {
    const game1 = new Correlation('random');
    const game2 = new Correlation('random');
    const game3 = new Correlation('iii');
    for (const item of simItems) {
        const game = item.gameCount === 1 ? game1 : item.gameCount === 2 ? game2 : game3;
        game.add(item.totals);
    }
    game1.calculate();
    game2.calculate();
    game3.calculate();

    return {
        "1": game1.results(),
        "2": game2.results(),
        "3+": game3.results()
    }
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

export interface Total {
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

export type SimTotal = Record<strategyPattern | 'random', Total>;
interface SimItem {
    slotTotal: number;
    slotIndex: number;
    gameCount: number;
    picksCount: number;
    totals: SimTotal;
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

        picksCount = 0;

        constructor() {
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
                    gameResult = new GameResult();
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

    const compile = (): CorrelationResults => {
        const results: SimItem[] = [];
        for (const [index, result] of gameResults) {
            const totals = {} as SimTotal;
            totals.random = { ...result.randomResults };
            for (const [type, strategy] of result.strategyResults) {
                totals[type] = { ...strategy };
            }

            results.push({
                totals,
                ...index,
                picksCount: result.picksCount
            });
        }
        return compileSimItems(results);
    }

    return compile();
}
