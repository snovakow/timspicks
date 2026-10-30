import { AllStrategyModes, LogStatsKeys, StrategyLabels, type LogStatsKey, type SportsbookKey, type StrategyMode } from "../dataTypes";
import type { Team } from "./logo";
import * as Feature from '../features';

import "./Table.css";
import "./sportsbook.css";

export const precision = 1;
export const comboPrecision = 2;

export interface LocalizedText {
	default: string;
	[key: string]: string;
}

export interface TeamInput {
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
	darkTheme: boolean,
	xgMap?: Map<string, number> | null
}) {
	const { games, darkTheme, xgMap } = props;
	const formatXG = (val: number): string => `xG: ${val.toFixed(2)}`;
	return (
		<table>
			<tbody>
				{games.map((game, idx) => {
					const xgHome = xgMap?.get(game.home.code) ?? null;
					const xgAway = xgMap?.get(game.away.code) ?? null;
					const xgGame = xgHome !== null && xgAway !== null ? xgHome + xgAway : null;
					return (
						<tr key={game.link} className={idx % 2 === 0 ? 'row-color' : 'row-color-alt'}>
							<td>
								<span className='cell-container right-align'>
									<span className="team-name-stack">
										{game.away.name}
										{xgAway !== null && <span className="xg-value away">{formatXG(xgAway)}</span>}
									</span>
									<img
										className='td-name-logo'
										src={darkTheme ? game.away.logoDark : game.away.logoLight}
										alt=""
										onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
									/>
								</span>
							</td>
							<td className="cell-container">
								<span className="team-name-stack center-stack">
									@
									{xgGame !== null && <span className="xg-value">{formatXG(xgGame)}</span>}
								</span>
							</td>
							<td>
								<span className='cell-container'>
									<img
										className='td-name-logo'
										src={darkTheme ? game.home.logoDark : game.home.logoLight}
										alt=""
										onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
									/>
									<span className="team-name-stack">
										{game.home.name}
										{xgHome !== null && <span className="xg-value home">{formatXG(xgHome)}</span>}
									</span>
								</span>
							</td>
							<td className="cell-container">
								{game.time.toLocaleTimeString([], timeFormat)}
							</td>
							{includeLinks && (
								<td><a href={game.link} target="_blank" rel="noopener noreferrer">🔗</a></td>
							)}
						</tr>
					)
				})}
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
	opponent: TeamData;
	logoLight: string;
	logoDark: string;
	gameTime: Date;
	homeGame: boolean;

	fullName: string;
	// Each shown book's implied probability under its key, as the tables use it: raw, or de-vigged when
	// that's on. Sorting, the stats and the replays read a book's value as player[key]
	[book: SportsbookKey]: number | null;
	// Each shown book's implied probability as the book gave it
	raw: Partial<Record<SportsbookKey, number | null>> = {};
	betAvg: number | null = null;
	// The text each book's cell and the Avg's show
	display: Partial<Record<LogStatsKey, string>> = {};
	betCount: number = 0;

	pick: 0 | 1 | 2 | 3 = 0;

	constructor(data: PlayerInput, team: TeamData, opponent: TeamData, homeGame: boolean, gameTime: Date) {
		this.playerId = data.playerId;

		this.firstName = data.firstName;
		this.lastName = data.lastName;
		this.team = team;
		this.opponent = opponent;
		this.gameTime = gameTime;
		this.homeGame = homeGame;

		this.logoLight = this.team.logoLight;
		this.logoDark = this.team.logoDark;

		const first = this.firstName.default.toLowerCase();
		const last = this.lastName.default.toLowerCase();
		const linkteam = this.team.name.toLowerCase().replace(/\s/g, "");

		this.link = `https://www.nhl.com/${linkteam}/player/${first}-${last}-${this.playerId}`;

		this.fullName = `${this.firstName.default} ${this.lastName.default}`;
	}
	sameTeam(other: Player): boolean {
		return this.team.code === other.team.code;
	}
	opponentTeam(other: Player): boolean {
		return this.team.code === other.opponent.code;
	}
	sameGame(other: Player): boolean {
		return this.sameTeam(other) || this.opponentTeam(other);
	}
}

export type ColumnKeys = LogStatsKey | 'fullName' | 'pick' | 'gameTime';
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

export class PickOdds {
	player: Player;

	// The books, and the Avg, whose top ticket holds this player, and the strategies each one picks him for
	highlight: Set<LogStatsKey> = new Set();
	strategy: Map<LogStatsKey, Set<StrategyMode>> = new Map();
	constructor(player: Player) {
		this.player = player;
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
	enabledStrategies: Record<StrategyMode, boolean>
}) {
	const { columns, sortedRows, requestSort, sortConfig, darkTheme, enabledStrategies } = props;
	const enabledModes = AllStrategyModes.filter((mode) => enabledStrategies[mode]);
	const strategyLabel = (mode: StrategyMode): string => StrategyLabels[mode];
	const strategyTitle = (strategy: Set<StrategyMode>): string => {
		const active = enabledModes.filter((mode) => strategy.has(mode));
		if (active.length === 0) return 'No strategy tags';
		return `Strategies: ${active.map(strategyLabel).join(', ')}`;
	};
	const renderStrategyDots = (strategy: Set<StrategyMode>) => {
		return (
			<span className='cell-strategy-dots' aria-hidden='true'>
				{enabledModes.map((mode) => (
					<span key={mode} className={`cell-strategy-dot cell-strategy-dot-${mode}${strategy.has(mode) ? ' cell-strategy-dot-active' : ''}`} />
				))}
			</span>
		);
	};
	const visibleStrategyFor = (row: PickOdds, key: LogStatsKey): Set<StrategyMode> | undefined => {
		const strategy = row.strategy.get(key);
		return strategy && enabledModes.some((mode) => strategy.has(mode)) ? strategy : undefined;
	};
	const renderBetCell = (key: LogStatsKey, value: string, highlight?: boolean, strategy?: Set<StrategyMode>) => {
		const classes = [highlight && strategy ? cellClass(highlight) : undefined, strategy ? 'cell-bet-with-dots' : undefined]
			.filter(Boolean)
			.join(' ');
		const show = strategy && Feature.correlation;
		return (
			<td key={key} className={classes || undefined} title={show ? strategyTitle(strategy) : undefined}>
				<span className='cell-bet-value'>{value}</span>
				{show && renderStrategyDots(strategy)}
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
												className='theader-logo-bg sportsbook-logo-rounded'
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

							{LogStatsKeys.map((key) => renderBetCell(key, player.display[key] ?? '-', picks ? row.highlight.has(key) : undefined, picks ? visibleStrategyFor(row, key) : undefined))}
							{!picks && (<td>{(row.pick === 0 ? "-" : row.pick)}</td>)}
							{!picks && (<td className="cell-container">{row.gameTime?.toLocaleTimeString([], timeFormat)}</td>)}
						</tr>
					)
				})}
			</tbody>
		</table>
	)
}
