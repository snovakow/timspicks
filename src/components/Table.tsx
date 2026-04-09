import { type Team } from "./logo";
import "./Table.css";

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

const includeLinks = false;

export function Basic(props: {
	games: GameData[],
	darkTheme: boolean
}) {
	const { games, darkTheme } = props;
	return (
		<table>
			<tbody>
				{games.map((game, idx) => (
					<tr key={game.link} className={idx % 2 === 0 ? 'row-color' : 'row-color-alt'}>
						<td>
							<span className='cell-container right-align'>
								{game.away.name}
								<img
									className='td-name-logo'
									src={darkTheme ? game.away.logoDark : game.away.logoLight}
									alt=""
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
									alt=""
									onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
								/>
								{game.home.name}
							</span>
						</td>
						<td className="cell-container">
							{game.time.toLocaleTimeString([], timeFormat)}
						</td>
						{includeLinks && (
							<td><a href={game.link} target="_blank" rel="noopener noreferrer">🔗</a></td>
						)}
					</tr>
				))}
			</tbody>
		</table>
	);
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
	betRaw1: number | null = null;
	betRaw2: number | null = null;
	betRaw3: number | null = null;
	betRaw4: number | null = null;
	bet1: number | null = null;
	bet2: number | null = null;
	bet3: number | null = null;
	bet4: number | null = null;
	betAvg: number | null = null;
	betDisplay1: string = "-";
	betDisplay2: string = "-";
	betDisplay3: string = "-";
	betDisplay4: string = "-";
	betDisplayAvg: string = "-";
	betCount: number = 0;

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
		const linkteam = this.team.name.toLowerCase().replace(/\s/g, "");

		this.link = `https://www.nhl.com/${linkteam}/player/${first}-${last}-${this.playerId}`;

		this.fullName = `${this.firstName.default} ${this.lastName.default}`;
	}
}

export type ColumnKeys = 'fullName' | 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'betAvg' | 'ggRaw' | 'pick' | 'gameTime';
export interface ColumnData {
	key: ColumnKeys;
	title: string;
	sort: boolean;
	logo?: string;
}

export interface OddsItem {
	playerId: number;
	gamesPlayed: number;
	firstName: string;
	lastName: string;
	goals: number;
}

export type StrategyMode = 'streak' | 'point' | 'leaderboard' | 'hybrid' | 'top';
export class PickOdds {
	player: Player;

	ggRaw: number;
	ggDisplay: string;
	highlight1: boolean = false;
	highlight2: boolean = false;
	highlight3: boolean = false;
	highlight4: boolean = false;
	highlightAvg: boolean = false;
	strategy1: Set<StrategyMode> = new Set();
	strategy2: Set<StrategyMode> = new Set();
	strategy3: Set<StrategyMode> = new Set();
	strategy4: Set<StrategyMode> = new Set();
	strategyAvg: Set<StrategyMode> = new Set();
	constructor(player: Player, item: OddsItem) {
		this.player = player;
		this.ggRaw = item.gamesPlayed > 0 ? item.goals / item.gamesPlayed : 0;
		this.ggDisplay = "-";
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
	darkTheme: boolean
}) {
	const { columns, sortedRows, requestSort, sortConfig, darkTheme } = props;
	const strategyLabel = (mode: StrategyMode): string => {
		if (mode === 'streak') return 'Streak';
		if (mode === 'point') return 'Points';
		if (mode === 'leaderboard') return 'Leaderboard';
		return 'Hybrid';
	};
	const strategyTitle = (strategy: Set<StrategyMode>): string => {
		const modes: StrategyMode[] = ['streak', 'point', 'leaderboard', 'hybrid'];
		const active = modes.filter((mode) => strategy.has(mode));
		if (active.length === 0) return 'No strategy tags';
		return `Strategies: ${active.map(strategyLabel).join(', ')}`;
	};
	const renderStrategyDots = (strategy: Set<StrategyMode>) => {
		return (
			<span className='cell-strategy-dots' aria-hidden='true'>
				<span className={`cell-strategy-dot cell-strategy-dot-streak${strategy.has('streak') ? ' cell-strategy-dot-active' : ''}`} />
				<span className={`cell-strategy-dot cell-strategy-dot-point${strategy.has('point') ? ' cell-strategy-dot-active' : ''}`} />
				<span className={`cell-strategy-dot cell-strategy-dot-leaderboard${strategy.has('leaderboard') ? ' cell-strategy-dot-active' : ''}`} />
				<span className={`cell-strategy-dot cell-strategy-dot-hybrid${strategy.has('hybrid') ? ' cell-strategy-dot-active' : ''}`} />
				<span className={`cell-strategy-dot cell-strategy-dot-top${strategy.has('top') ? ' cell-strategy-dot-active' : ''}`} />
			</span>
		);
	};
	const strategyFor = (row: PickOdds, key: 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'betAvg'): Set<StrategyMode> => {
		if (key === 'bet1') return row.strategy1;
		if (key === 'bet2') return row.strategy2;
		if (key === 'bet3') return row.strategy3;
		if (key === 'bet4') return row.strategy4;
		return row.strategyAvg;
	};
	const visibleStrategyFor = (row: PickOdds, key: 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'betAvg'): Set<StrategyMode> | undefined => {
		const strategy = strategyFor(row, key);
		return strategy.size > 0 ? strategy : undefined;
	};
	const renderBetCell = (value: string, highlight?: boolean, strategy?: Set<StrategyMode>) => {
		const classes = [highlight ? cellClass(highlight) : undefined, strategy ? 'cell-bet-with-dots' : undefined]
			.filter(Boolean)
			.join(' ');
		return (
			<td className={classes || undefined} title={strategy ? strategyTitle(strategy) : undefined}>
				<span className='cell-bet-value'>{value}</span>
				{strategy && renderStrategyDots(strategy)}
			</td>
		);
	};
	const cellClass = (highlight: boolean): string | undefined => {
		if (highlight) return "highlight-top-bg";
		return undefined;
	};
	return (
		<table>
			<thead>
				<tr>
					{
						columns.map(item => {
							return (
								<th key={item.key}
									colSpan={item.key === "fullName" ? (includeLinks ? 2 : 1) : 1}
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
					const rowKey = picks ? row.player.playerId : row.playerId;
					return (
						<tr key={rowKey} className={idx % 2 === 0 ? 'row-color' : 'row-color-alt'}>
							<td>
								<span className='cell-container'>
									<img className='td-name-logo' src={darkTheme ? player.logoDark : player.logoLight} alt="" />
									{player.fullName}
								</span>
							</td>
							{includeLinks && (
								<td><a href={player.link} target="_blank" rel="noopener noreferrer">🔗</a></td>
							)}

							{picks && (<td>{row.ggDisplay}</td>)}
							{renderBetCell(player.betDisplay1, picks ? row.highlight1 : undefined, picks ? visibleStrategyFor(row, 'bet1') : undefined)}
							{renderBetCell(player.betDisplay2, picks ? row.highlight2 : undefined, picks ? visibleStrategyFor(row, 'bet2') : undefined)}
							{renderBetCell(player.betDisplay3, picks ? row.highlight3 : undefined, picks ? visibleStrategyFor(row, 'bet3') : undefined)}
							{renderBetCell(player.betDisplay4, picks ? row.highlight4 : undefined, picks ? visibleStrategyFor(row, 'bet4') : undefined)}
							{renderBetCell(player.betDisplayAvg, picks ? row.highlightAvg : undefined, picks ? visibleStrategyFor(row, 'betAvg') : undefined)}
							{!picks && (<td>{(row.pick === 0 ? "-" : row.pick)}</td>)}
							{!picks && (<td className="cell-container">{row.gameTime?.toLocaleTimeString([], timeFormat)}</td>)}
						</tr>
					)
				})}
			</tbody>
		</table>
	)
}
