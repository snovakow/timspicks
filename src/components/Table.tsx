import { type Team } from "./logo";

export const precision = 1;

interface LocalizedText {
    default: string;
    [key: string]: string;
}

interface TeamInput {
    placeName: LocalizedText;
    commonName: LocalizedText;
    abbrev: Team;
    logo: string;
    darkLogo: string;
}

interface GameInput {
    gameCenterLink: string;
    homeTeam: TeamInput;
    awayTeam: TeamInput;
    startTimeUTC: string;
}

interface PlayerInput {
    playerId: number;
    firstName: LocalizedText;
    lastName: LocalizedText;
}

export class TeamData {
    place: string;
    name: string;
    code: Team;
    logoLight: string;
    logoDark: string;
    constructor(data: TeamInput) {
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
    constructor(data: GameInput) {
        this.link = "https://www.nhl.com" + data.gameCenterLink;
        this.home = new TeamData(data.homeTeam);
        this.away = new TeamData(data.awayTeam);
        this.time = new Date(data.startTimeUTC);
    }
}

const timeFormat: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

export function Basic(props: {
    games: GameData[],
    darkTheme: boolean
}) {
    const { games, darkTheme } = props;
    return (
        <table>
            <tbody>
                {games.map((game, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'row-color' : 'row-color-alt'}>
                        <td>
                            <span className='cell-container right-align'>
                                {`${game.away.place} ${game.away.name}`}
                                <img
                                    className='td-name-logo'
                                    src={darkTheme ? game.away.logoDark : game.away.logoLight}
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                            </span>
                        </td>
                        <td>@</td>
                        <td>
                            <span className='cell-container'>
                                <img
                                    className='td-name-logo'
                                    src={darkTheme ? game.home.logoDark : game.home.logoLight}
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                                {`${game.home.place} ${game.home.name}`}
                            </span>
                        </td>
                        <td className="cell-container">
                            {game.time.toLocaleTimeString([], timeFormat)}
                        </td>
                        <td>
                            <a href={game.link} target="_blank" rel="noopener noreferrer">🔗</a>
                        </td>
                    </tr>
                )
                )}
            </tbody>
        </table>
    )
}

export class Player {
    playerId: number;
    firstName: LocalizedText;
    lastName: LocalizedText;
    link: string;

    team: TeamData;
    logoLight: string;
    logoDark: string;
    gameTime: Date;

    fullName: string;
    bet1: number | null = null;
    bet2: number | null = null;
    bet3: number | null = null;
    bet4: number | null = null;
    betChance1: string = "-";
    betChance2: string = "-";
    betChance3: string = "-";
    betChance4: string = "-";

    pick: 0 | 1 | 2 | 3 = 0;

    constructor(data: PlayerInput, team: TeamData, gameTime: Date) {
        this.playerId = data.playerId;

        this.firstName = data.firstName;
        this.lastName = data.lastName;
        this.team = team;
        this.gameTime = gameTime;

        this.logoLight = this.team.logoLight;
        this.logoDark = this.team.logoDark;

        const first = this.firstName.default.toLowerCase();
        const last = this.lastName.default.toLowerCase();
        const linkteam = this.team.name.toLowerCase();
        this.link = `https://www.nhl.com/${linkteam}/player/${first}-${last}-${this.playerId}`;

        this.fullName = `${this.firstName.default} ${this.lastName.default}`;
    }
}

export type ColumnKeys = "fullName" | "bet1" | "bet2" | "bet3" | "bet4" | "gg" | "pick" | "gameTime";
export interface ColumnData {
    key: ColumnKeys;
    title: string;
    sort: boolean;
    logo?: string;
}

export interface OddsItem {
    playerId: number;
    gamesPlayed: number;
    goals: number;
}

// Poisson distribution chance of 0 goals: e^(−μ)
// Chance of at least one goal: 1 − e^(−μ)
const ggChance = (x: number): string => {
    const chance = 1 - Math.exp(-x);
    return (chance * 100).toFixed(precision) + "%";
}

export class PickOdds {
    player: Player;

    gg: number;
    ggChance: string;
    highlight1 = false;
    highlight2 = false;
    highlight3 = false;
    highlight4 = false;
    constructor(player: Player, item: OddsItem) {
        this.player = player;

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
                        columns.map(item => {
                            return (
                                <th key={item.key}
                                    colSpan={item.key === "fullName" ? 2 : 1}
                                    className={item.sort ? 'sortable' : undefined}
                                    onClick={item.sort ? () => requestSort(item.key) : undefined}>
                                    <span className={'cell-container'}>
                                        {item.sort && <span className={'theader-pad'}>▲</span>}
                                        {item.logo ? (
                                            <img
                                                className='theader-logo-bg logo-rounded'
                                                src={item.logo}
                                                title={item.title}
                                                alt=''
                                                aria-hidden='true'
                                            />
                                        ) : (
                                            <span className='theader-title'>{item.title}</span>
                                        )}
                                        {item.sort && <span className={sortConfig?.keyOrder[0] === item.key ? 'theader-sort' : 'theader-sort-hidden'}>▲</span>}
                                    </span>
                                </th>
                            )
                        })
                    }
                </tr>
            </thead>
            <tbody>
                {sortedRows.map((row, idx) => {
                    const picks = row instanceof PickOdds;
                    const player = picks ? row.player : row;
                    return (
                        <tr key={idx} className={idx % 2 === 0 ? 'row-color' : 'row-color-alt'}>
                            <td>
                                <span className='cell-container'>
                                    <img className='td-name-logo' src={darkTheme ? player.logoDark : player.logoLight} />
                                    {player.fullName}
                                </span>
                            </td>
                            <td>
                                <a href={player.link} target="_blank" rel="noopener noreferrer">🔗</a>
                            </td>

                            {picks && (<td>{chances ? row.ggChance : row.gg.toFixed(2)}</td>)}
                            <td className={picks && row.highlight1 ? "highlight" : undefined}>
                                {chances ? player.betChance1 : (player.bet1 === null ? "-" : player.bet1)}
                            </td>
                            <td className={picks && row.highlight2 ? "highlight" : undefined}>
                                {chances ? player.betChance2 : (player.bet2 === null ? "-" : player.bet2)}
                            </td>
                            <td className={picks && row.highlight3 ? "highlight" : undefined}>
                                {chances ? player.betChance3 : (player.bet3 === null ? "-" : player.bet3)}
                            </td>
                            <td className={picks && row.highlight4 ? "highlight" : undefined}>
                                {chances ? player.betChance4 : (player.bet4 === null ? "-" : player.bet4)}
                            </td>
                            {!picks && (<td>{(row.pick === 0 ? "-" : row.pick)}</td>)}
                            {!picks && (<td className="cell-container">{row.gameTime?.toLocaleTimeString([], timeFormat)}</td>)}
                        </tr>
                    )
                })}
            </tbody>
        </table>
    )
}
