import { getLogo, type Team } from "./logo";

export class TeamData {
    place: string;
    name: string;
    code: Team;
    logoLight: string;
    logoDark: string;
    constructor(data: any) {
        this.place = data.placeName.default;
        this.name = data.commonName.default;
        this.code = data.abbrev;
        this.logoLight = data.logo;
        this.logoDark = data.darkLogo;
    }
}
export class GameData {
    link: string;
    home: TeamData;
    away: TeamData;
    time: Date;
    constructor(data: any) {
        this.link = "https://www.nhl.com" + data.gameCenterLink;
        this.home = new TeamData(data.homeTeam);
        this.away = new TeamData(data.awayTeam);
        this.time = new Date(data.startTimeUTC);
    }
}

const timeFormat: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

export function Basic(props: {
    columns: string[],
    games: GameData[],
    darkTheme: boolean
}) {
    const { columns, games, darkTheme } = props;
    return (
        <table>
            <thead>
                <tr>
                    {
                        columns.map((title, index) => (
                            <th key={index}>
                                <span className='cell-container'>
                                    <span className='theader-title'>{title}</span>
                                </span>
                            </th>
                        ))
                    }
                </tr>
            </thead>
            <tbody>
                {games.map((game, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'row-color' : 'row-color-alt'}>
                        <td>
                            <span className='cell-container'>
                                <img className='td-name-logo' src={darkTheme ? game.home.logoDark : game.home.logoLight} />
                                {`${game.home.place} ${game.home.name}`}
                            </span>
                        </td>
                        <td>
                            <span className='cell-container'>
                                <img className='td-name-logo' src={darkTheme ? game.away.logoDark : game.away.logoLight} />
                                {`${game.away.place} ${game.away.name}`}
                            </span>
                        </td>
                        <td>
                            {game.time.toLocaleTimeString([], timeFormat)}
                        </td>
                    </tr>
                )
                )}
            </tbody>
        </table>
    )
}

interface Name {
    default: string;
    [key: string]: string;
}
export class Player {
    playerId: number;
    firstName: Name;
    lastName: Name;
    link: string;

    team: TeamData;
    logoLight: string;
    logoDark: string;
    gameTime: Date;

    fullName: string;
    bet1: number | null = null;
    bet2: number | null = null;
    bet3: number | null = null;
    betChance1: string = "-";
    betChance2: string = "-";
    betChance3: string = "-";

    pick: 0 | 1 | 2 | 3 = 0;

    constructor(data: any, team: TeamData, gameTime: Date) {
        this.playerId = data.playerId;

        this.firstName = data.firstName;
        this.lastName = data.lastName;
        this.team = team;
        this.gameTime = gameTime;

        this.logoLight = this.team.logoLight;
        this.logoDark = this.team.logoDark;

        const first = this.firstName.default.toLowerCase();
        const last = this.lastName.default.toLowerCase();
        this.link = `https://www.nhl.com/bluejackets/player/${first}-${last}-${this.playerId}`;

        this.fullName = `${this.firstName.default} ${this.lastName.default}`;
    }
}

export type ColumnKeys = "fullName" | "bet1" | "bet2" | "bet3" | "gg" | "bet5v5" | "pick" | "gameTime";
export interface ColumnData {
    key: ColumnKeys;
    title: string;
    sort: boolean;
}

export interface OddsItem {
    playerId: number;
    firstName: string;
    lastName: string;
    team: string;

    gamesPlayed: number;
    goals: number;
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

export class PickOdds {
    playerId: number;
    firstName: string;
    lastName: string;
    fullName: string;
    bet1: number | null = null;
    bet2: number | null = null;
    bet3: number | null = null;
    betChance1: string = "-";
    betChance2: string = "-";
    betChance3: string = "-";

    logoLight: string;
    logoDark: string;
    gg: number;
    ggChance: string;
    bet5v5: number | null = null;
    betChance5v5: string = "-";
    highlight1 = false;
    highlight2 = false;
    highlight3 = false;
    highlight5v5 = false;
    constructor(item: OddsItem) {
        this.playerId = item.playerId;
        if (this.playerId < 0) this.playerId = -this.playerId;

        this.firstName = item.firstName;
        this.lastName = item.lastName;
        this.fullName = `${item.firstName} ${item.lastName}`;

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
    sortedRows: (Player | PickOdds)[],
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
                                className={item.sort ? 'sortable' : undefined}
                                onClick={item.sort ? () => requestSort(item.key) : undefined}>
                                <span className='cell-container'>
                                    {item.sort && <span className='theader-pad'>▲</span>}
                                    <span className='theader-title'>{item.title}</span>
                                    {item.sort && <span className={sortConfig?.keyOrder[0] === item.key ? 'theader-sort' : 'theader-sort-hidden'}>▲</span>}
                                </span>
                            </th>
                        ))
                    }
                </tr>
            </thead>
            <tbody>
                {sortedRows.map((row, idx) => {
                    const picks = row instanceof PickOdds;
                    return (
                        <tr key={idx} className={idx % 2 === 0 ? 'row-color' : 'row-color-alt'}>
                            <td>
                                <span className='cell-container'>
                                    {picks && (<img className='td-name-logo' src={darkTheme ? row.logoDark : row.logoLight} />)}
                                    {row.name}
                                </span>
                            </td>
                            {picks && (<td>{chances ? row.ggChance : row.gg.toFixed(2)}</td>)}
                            <td className={picks && row.highlight1 ? "highlight" : undefined}>
                                {chances ? row.betChance1 : (row.bet1 === null ? "-" : row.bet1)}
                            </td>
                            <td className={picks && row.highlight2 ? "highlight" : undefined}>
                                {chances ? row.betChance2 : (row.bet2 === null ? "-" : row.bet2)}
                            </td>
                            <td className={picks && row.highlight3 ? "highlight" : undefined}>
                                {chances ? row.betChance3 : (row.bet3 === null ? "-" : row.bet3)}
                            </td>
                            {picks && (<td className={picks && row.highlight5v5 ? "highlight" : undefined}>
                                {chances ? row.betChance5v5 : (row.bet5v5 === null ? "-" : row.bet5v5.toFixed(2))}
                            </td>)}
                            {!picks && (<td>{(row.pick === 0 ? "-" : row.pick)}</td>)}
                            {!picks && (<td>{row.gameTime.toLocaleTimeString([], timeFormat)}</td>)}
                        </tr>
                    )
                })}
            </tbody>
        </table>
    )
}
