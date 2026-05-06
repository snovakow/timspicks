import type { ComboPattern } from './dataTypes';
import { AllCombos } from './dataTypes';

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

export class ComboGroup<T> {
    combos: SelectionCandidate<T>[] = [];
    prob1 = 0;
    prob2 = 0;
    prob3 = 0;

    add(candidate: SelectionCandidate<T>) {
        const max1 = candidate.prob1 >= this.prob1;
        if (!max1) return;
        const max2 = candidate.prob2 >= this.prob2;
        if (!max2) return;
        const max3 = candidate.prob3 >= this.prob3;
        if (!max3) return;
        if (candidate.prob1 > this.prob1 || candidate.prob2 > this.prob2 || candidate.prob3 > this.prob3) {
            this.combos.splice(0, this.combos.length, candidate);
            this.prob1 = candidate.prob1;
            this.prob2 = candidate.prob2;
            this.prob3 = candidate.prob3;
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

export const selectStrategyCombos = <T>(candidates: Iterable<SelectionCandidate<T>>): {
    top: ComboGroup<T>;
    strategies: Map<ComboPattern, ComboGroup<T>>;
} => {
    const top = new ComboGroup<T>();
    const strategies = new Map<ComboPattern, ComboGroup<T>>();
    for (const strategy of AllCombos) strategies.set(strategy, new ComboGroup<T>());

    for (const candidate of candidates) {
        top.add(candidate);
        if (!candidate.strategy) continue;
        const combo = strategies.get(candidate.strategy);
        if (combo) combo.add(candidate);
    }

    return { top, strategies };
};