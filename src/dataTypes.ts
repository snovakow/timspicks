import logo1 from './sportsbook-logo/sb-logo-16-draftkings.svg';
import logo2 from './sportsbook-logo/sb-logo-16-fanduel.svg';
import logo3 from './sportsbook-logo/sb-logo-16-mgm.svg';
import logo4 from './sportsbook-logo/sb-logo-16-betrivers.svg';
import logo5 from './sportsbook-logo/sb-logo-16-score.svg';
import logo6 from './sportsbook-logo/bet365.svg';

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

// A book's key, which also names its odds file
export type SportsbookKey = `bet${number}`;

type BookMode = 'direct' | 'comparison' | 'off';
// public/sportsbooks.json as the build read it (vite.config.ts): every book in display order, with its mode
declare const __SPORTSBOOKS__: ReadonlyArray<{ key: SportsbookKey; title: string; mode: BookMode }>;

// The books the page shows, in the list's order. A book that's off isn't fetched or shown
const shownBooks = __SPORTSBOOKS__.filter((book) => book.mode !== 'off');
export const SportsbookKeys: readonly SportsbookKey[] = shownBooks.map((book) => book.key);

export type LogStatsKey = SportsbookKey | 'betAvg';
export const LogStatsKeys: readonly LogStatsKey[] = [...SportsbookKeys, 'betAvg'];

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
    logo?: string;
};
// Each book's logo; one without shows its title instead
const logos: Partial<Record<SportsbookKey, string>> = {
    bet1: logo1,
    bet2: logo2,
    bet3: logo3,
    bet4: logo4,
    bet5: logo5,
    bet6: logo6,
};
export const Sportsbooks: Record<SportsbookKey, Sportsbook> = Object.fromEntries(
    shownBooks.map((book) => [book.key, { title: book.title, logo: logos[book.key] }])
);

export const AllPoolSlots = ['1', '2', '3', '4+', 'all'] as const;
export type PoolSlots = typeof AllPoolSlots[number];
