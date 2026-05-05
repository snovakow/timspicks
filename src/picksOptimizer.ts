import * as Picks from "./components/Table";
import { deVig, oddsNameMap } from "./dataProcessor";
import type { strategyPattern, LogStatsKey } from "./sportsbookTypes";
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

type CorrelationData = Record<typeof allStrategies[number], number>;
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
        count: {} as CorrelationData
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
            this.strategy.least1[combo] = 0;
            this.strategy.points[combo] = 0;
            this.strategy.hits[combo] = 0;
            this.strategy.count[combo] = 0;
        }
    }
    add(result: SimTotal) {
        for (const combo of allStrategies) {
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
            "iii": 1,
            "sss": 0.996839653355068,
            "iss": 1,
            "sis": 1,
            "ssi": 1,
            "ioo": 1,
            "oio": 1,
            "ooi": 1,
            "oso": 0.996827193046244,
            "soo": 0.9945393512562785,
            "sos": 1.0046823292452218,
            "oss": 1.0026051073382294
        },
        "points": {
            "iii": 1,
            "sss": 1.0018954666041948,
            "iss": 1,
            "sis": 1,
            "ssi": 1,
            "ioo": 1,
            "oio": 1,
            "ooi": 1,
            "oso": 0.9974622374760997,
            "soo": 0.995988269641441,
            "sos": 0.9982678355009676,
            "oss": 0.9996572909709979
        },
        "hits": {
            "iii": 1,
            "sss": 1.0018958323702598,
            "iss": 1,
            "sis": 1,
            "ssi": 1,
            "ioo": 1,
            "oio": 1,
            "ooi": 1,
            "oso": 0.9976588928196853,
            "soo": 0.996152522285613,
            "sos": 0.9987702879330903,
            "oss": 0.9994112295641178
        }
    },
    "2": {
        "least1": {
            "iii": 1,
            "sss": 0.9945483388252138,
            "iss": 0.9897205692295595,
            "sis": 0.9948920888753644,
            "ssi": 0.9909964957705172,
            "ioo": 0.99469763699499,
            "oio": 0.9962502873185816,
            "ooi": 1.0038063608620325,
            "oso": 0.9954719700619686,
            "soo": 0.9943246513547587,
            "sos": 1.0074459494488206,
            "oss": 1.0064851342852252
        },
        "points": {
            "iii": 1,
            "sss": 0.9989225383521498,
            "iss": 0.9898675774645203,
            "sis": 0.9978620000192502,
            "ssi": 0.9959422567410268,
            "ioo": 0.9935272331059917,
            "oio": 0.9928145928864581,
            "ooi": 1.0028653534892575,
            "oso": 0.9950585669500164,
            "soo": 0.9930103041491385,
            "sos": 1.0054937905691095,
            "oss": 0.9976705114145951
        },
        "hits": {
            "iii": 1,
            "sss": 0.9991629036889742,
            "iss": 0.990235621886617,
            "sis": 0.9976793873645744,
            "ssi": 0.9961816461560711,
            "ioo": 0.9943113531234588,
            "oio": 0.9937057176671985,
            "ooi": 1.0028061154460488,
            "oso": 0.9963096230247007,
            "soo": 0.9941905475430038,
            "sos": 1.0057489459780808,
            "oss": 0.9990395992563039
        }
    },
    "3+": {
        "least1": {
            "iii": 1.000001470944074,
            "sss": 0.9962053511846757,
            "iss": 0.9970311670027291,
            "sis": 0.9961689625699996,
            "ssi": 0.9999215723484034,
            "ioo": 0.9980618535607254,
            "oio": 1.0016981173292592,
            "ooi": 1.0105326245646056,
            "oso": 1.000013821984077,
            "soo": 1.0003057273949352,
            "sos": 1.0082970484735623,
            "oss": 1.00516405499711
        },
        "points": {
            "iii": 1.0000000502803745,
            "sss": 0.9887300472948585,
            "iss": 0.9933561617016667,
            "sis": 0.9958284701836525,
            "ssi": 0.9964720437216372,
            "ioo": 0.9948438686066201,
            "oio": 0.9988387413911266,
            "ooi": 1.0105811366881516,
            "oso": 0.995889417513272,
            "soo": 0.995662491304212,
            "sos": 1.0035379168365717,
            "oss": 1.0001556236303408
        },
        "hits": {
            "iii": 1.0000012650933543,
            "sss": 0.989429349125283,
            "iss": 0.9940097374619715,
            "sis": 0.9958534690901631,
            "ssi": 0.996809514513958,
            "ioo": 0.9953723560465657,
            "oio": 0.999353608508294,
            "ooi": 1.0101873474279193,
            "oso": 0.9971234524985559,
            "soo": 0.9968837107131758,
            "sos": 1.0039504248654205,
            "oss": 1.0008660793742659
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
