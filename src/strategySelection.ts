import type { ComboPattern } from './dataTypes';

export interface PlayerType<T> {
    sameTeam(other: PlayerType<T>): boolean;
    opponentTeam(other: PlayerType<T>): boolean;
    sameGame(other: PlayerType<T>): boolean;
}
export const getStrategy = <T>(pick1: PlayerType<T>, pick2: PlayerType<T>, pick3: PlayerType<T>): ComboPattern | null => {
    if (!pick1.sameGame(pick2) && !pick2.sameGame(pick3) && !pick1.sameGame(pick3)) return 'iii';
    if (pick1.sameTeam(pick2) && pick2.sameTeam(pick3)) return 'sss';

    if (pick2.sameTeam(pick3) && !pick1.sameGame(pick2)) return 'iss';
    if (pick1.sameTeam(pick3) && !pick2.sameGame(pick1)) return 'sis';
    if (pick1.sameTeam(pick2) && !pick3.sameGame(pick1)) return 'ssi';

    if (pick2.opponentTeam(pick3) && !pick1.sameGame(pick2)) return 'ioo';
    if (pick1.opponentTeam(pick3) && !pick2.sameGame(pick1)) return 'oio';
    if (pick1.opponentTeam(pick2) && !pick3.sameGame(pick1)) return 'ooi';

    if (pick2.sameTeam(pick3) && pick1.opponentTeam(pick2)) return 'oss';
    if (pick1.sameTeam(pick3) && pick1.opponentTeam(pick2)) return 'sos';
    if (pick1.sameTeam(pick2) && pick3.opponentTeam(pick1)) return 'sso';

    return null;
}

export type SelectionCandidate<T> = {
    pick1: T;
    pick2: T;
    pick3: T;
    prob1: number;
    prob2: number;
    prob3: number;
    strategy: ComboPattern | null;
};

export type MergedSelection<T> = {
    picks1: Set<T>;
    picks2: Set<T>;
    picks3: Set<T>;
    prob1: number;
    prob2: number;
    prob3: number;
    representative: SelectionCandidate<T>;
    combos: SelectionCandidate<T>[];
};

// The default score: the sum of probabilities, order-independent since addition is commutative
const probabilitySum = <T>(candidate: SelectionCandidate<T>): number => candidate.prob1 + candidate.prob2 + candidate.prob3;

export class ComboGroup<T> {
    combos: SelectionCandidate<T>[] = [];
    prob1 = 0;
    prob2 = 0;
    prob3 = 0;
    best = 0;
    score: (candidate: SelectionCandidate<T>) => number;

    constructor(score: (candidate: SelectionCandidate<T>) => number = probabilitySum) {
        this.score = score;
    }

    add(candidate: SelectionCandidate<T>) {
        // All candidates with the highest score are kept as ties.
        const candidateScore = this.score(candidate);

        if (candidateScore < this.best) return;

        if (candidateScore > this.best) {
            this.combos.splice(0, this.combos.length, candidate);
            this.prob1 = candidate.prob1;
            this.prob2 = candidate.prob2;
            this.prob3 = candidate.prob3;
            this.best = candidateScore;
            return;
        }
        this.combos.push(candidate);
    }

    merge(): MergedSelection<T> | null {
        const representative = this.combos[0];
        if (!representative) return null;

        const picks1 = new Set<T>();
        const picks2 = new Set<T>();
        const picks3 = new Set<T>();
        for (const combo of this.combos) {
            picks1.add(combo.pick1);
            picks2.add(combo.pick2);
            picks3.add(combo.pick3);
        }

        return {
            picks1,
            picks2,
            picks3,
            prob1: representative.prob1,
            prob2: representative.prob2,
            prob3: representative.prob3,
            representative,
            combos: [...this.combos],
        };
    }
}