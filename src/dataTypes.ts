import logo1 from './sportsbook-logo/sb-logo-16-draftkings.svg';
import logo2 from './sportsbook-logo/sb-logo-16-fanduel.svg';
import logo3 from './sportsbook-logo/sb-logo-16-mgm.svg';
import logo4 from './sportsbook-logo/sb-logo-16-betrivers.svg';

export const AllStrategies = ['least1', 'points', 'hits'] as const;
export type Strategy = typeof AllStrategies[number];

export const AllStrategyModes = [...AllStrategies, 'top'] as const;
export type StrategyMode = typeof AllStrategyModes[number];

export const StrategyLabels: Record<StrategyMode, string> = {
    least1: 'Streak',
    points: 'Points',
    hits: 'Pick%',
    top: 'Top'
};

export const AllCombos = [
    'iii', 'sss',
    'iss', 'sis', 'ssi',
    'ioo', 'oio', 'ooi',
    'oss', 'sos', 'sso',
] as const;
export type ComboPattern = typeof AllCombos[number];

export const strategyTitle = (strategy: ComboPattern): string => {
    if (strategy === 'iii') return "All Independent";
    if (strategy === 'sss') return "All Stacked";
    if (strategy === 'iss') return "2-3 Stacked, 1 Independent";
    if (strategy === 'sis') return "1-3 Stacked, 2 Independent";
    if (strategy === 'ssi') return "1-2 Stacked, 3 Independent";
    if (strategy === 'ioo') return "2-3 Opposing, 1 Independent";
    if (strategy === 'oio') return "1-3 Opposing, 2 Independent";
    if (strategy === 'ooi') return "1-2 Opposing, 3 Independent";
    if (strategy === 'oss') return "2-3 Stacked, 1 Opposing";
    if (strategy === 'sos') return "1-3 Stacked, 2 Opposing";
    if (strategy === 'sso') return "1-2 Stacked, 3 Opposing";
    return strategy;
}

export const SportsbookKeys = ['bet1', 'bet2', 'bet3', 'bet4'] as const;
export type SportsbookKey = typeof SportsbookKeys[number];

export const LogStatsKeys = [...SportsbookKeys, 'betAvg'] as const;
export type LogStatsKey = typeof LogStatsKeys[number];

export type LogStatAlign = 'left' | 'center';
export interface LogLine {
    text: string;
    align: LogStatAlign;
    bold: boolean;
    title: boolean;
}
export type LogLines = LogLine[][];

export type SportsbookLog = Record<LogStatsKey, LogLines>;

export type Sportsbook = {
    title: string;
    logo: string;
};
export const Sportsbooks: Record<SportsbookKey, Sportsbook> = {
    bet1: { title: "DraftKings", logo: logo1 },
    bet2: { title: "FanDuel", logo: logo2 },
    bet3: { title: "BetMGM", logo: logo3 },
    bet4: { title: "BetRivers", logo: logo4 },
};

export const AllPoolSlots = ['1', '2', '3', '4+', 'all'] as const;
export type PoolSlots = typeof AllPoolSlots[number];
