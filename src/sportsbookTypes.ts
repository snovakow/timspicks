import logo1 from './sportsbook-logo/sb-logo-16-draftkings.svg';
import logo2 from './sportsbook-logo/sb-logo-16-fanduel.svg';
import logo3 from './sportsbook-logo/sb-logo-16-mgm.svg';
import logo4 from './sportsbook-logo/sb-logo-16-betrivers.svg';

export type Strategy = 'least1' | 'points' | 'hits';
export type StrategyMode = Strategy | 'top';

export const allStrategies = [
    'iii', 'sss',
    'iss', 'sis', 'ssi',
    'ioo', 'oio', 'ooi',
    'oso', 'soo', 'sos', 'oss'
] as const;
export type strategyPattern = typeof allStrategies[number];

export const SportsbookKeys = ['bet1', 'bet2', 'bet3', 'bet4'] as const;
export const LogStatsKeys = [...SportsbookKeys, 'betAvg'] as const;

export type SportsbookKey = typeof SportsbookKeys[number];
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
export const sportsbooks: Record<SportsbookKey, Sportsbook> = {
    bet1: { title: "DraftKings", logo: logo1 },
    bet2: { title: "FanDuel", logo: logo2 },
    bet3: { title: "BetMGM", logo: logo3 },
    bet4: { title: "BetRivers", logo: logo4 },
};
