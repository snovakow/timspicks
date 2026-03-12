import type { DataTimsHelper } from "../data/Data";
import { getLogo, type Team } from "./logo";

export type ColumnKeys = "name" | "bet1" | "bet2" | "bet3" | "gg" | "bet5v5";
export interface ColumnData {
    key: ColumnKeys;
    title: string;
}

export class PlayerOdds {
    name: string;
    bet1: number | null = null;
    bet2: number | null = null;
    bet3: number | null = null;
    betChance1: string = "-";
    betChance2: string = "-";
    betChance3: string = "-";
    constructor(name: string) {
        this.name = name;
    }
}

export const rountdToPercent = (num: number, places: number): string => {
    return (num * 100).toFixed(places) + "%";
}

// Poisson distribution chance of 0 goals: e^(−μ)
// Chance of at least one goal: 1 − e^(−μ)
export const ggChance = (x: number): string => {
    const chance = 1 - Math.exp(-x);
    return rountdToPercent(chance, 2);
}

export class PickOdds extends PlayerOdds {
    logoLight: string;
    logoDark: string;
    gg: number;
    ggChance: string;
    bet5v5: number | null = null;
    betChance5v5: string = "-";
    constructor(item: DataTimsHelper) {
        super(`${item.firstName} ${item.lastName}`);

        this.logoLight = getLogo(item.team as Team, false);
        this.logoDark = getLogo(item.team as Team, true);
        this.gg = item.gamesPlayed > 0 ? item.goals / item.gamesPlayed : 0;
        this.ggChance = ggChance(this.gg);
    }
}

export type RequestSort = (key: ColumnKeys) => void;

export interface SortConfig {
    keyOrder: ColumnKeys[];
}

export function Table(props: {
    columns: ColumnData[],
    sortedRows: (PlayerOdds | PickOdds)[],
    requestSort: RequestSort,
    sortConfig: SortConfig,
    darkTheme: boolean,
    chances: boolean
}) {
    const { columns, sortedRows, requestSort, sortConfig, darkTheme, chances } = props;
    return (
        <table>
            <thead>
                <tr>
                    {
                        columns.map(item => (
                            <th key={item.key}
                                onClick={() => requestSort(item.key)}>
                                <span className='cell-container'>
                                    <span className='theader-pad'>▲</span>
                                    <span className='theader-title'>{item.title}</span>
                                    <span className={sortConfig?.keyOrder[0] === item.key ? 'theader-sort' : 'theader-sort-hidden'}>▲</span>
                                </span>
                            </th>
                        ))
                    }
                </tr>
            </thead>
            <tbody>
                {sortedRows.map((row, idx) => {
                    let img = null;
                    if (row instanceof PickOdds) img = (
                        <img className='td-name-logo' src={darkTheme ? row.logoDark : row.logoLight} />
                    );
                    const picks = row instanceof PickOdds;
                    return (
                        <tr key={idx} className={idx % 2 === 0 ? 'row-color' : 'row-color-alt'}>
                            <td>
                                <span className='cell-container'>
                                    {img}{row.name}
                                </span>
                            </td>
                            {picks && (<td>{chances ? row.ggChance : row.gg.toFixed(2)}</td>)}
                            <td>{chances ? row.betChance1 : (row.bet1 === null ? "-" : row.bet1)}</td>
                            <td>{chances ? row.betChance2 : (row.bet2 === null ? "-" : row.bet2)}</td>
                            <td>{chances ? row.betChance3 : (row.bet3 === null ? "-" : row.bet3)}</td>
                            {picks && (<td>{chances ? row.betChance5v5 : (row.bet5v5 === null ? "-" : row.bet5v5.toFixed(2))}</td>)}
                        </tr>
                    )
                })}
            </tbody>
        </table>
    )
}
