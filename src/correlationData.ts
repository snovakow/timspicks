// How often two listed players from one game both score, relative to their odds, against the same days'
// pairs from different games: 1 means no correlation. Fitted from the archive by runSimulation, which logs
// this object when analyze is 'GENERATE'; from, through, days and playerDays say what it was fitted on.
export interface PairLifts {
    teammates: number;
    opponents: number;
    from: string;
    through: string;
    days: number;
    playerDays: number;
}

export const pairLifts: PairLifts = {
    "teammates": 1.013069480040033,
    "opponents": 0.9955136726708905,
    "from": "2026-04-09",
    "through": "2026-10-15",
    "days": 68,
    "playerDays": 4057
};
