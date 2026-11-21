import CollapsibleSection from './CollapsibleSection';
import { GoalMark } from './Table';
import type { DayScores } from '../dataProcessor';
import { PickTables, type EnteredDay } from '../enteredPicks';
import { startTime } from '../utility';

import './MyPicks.css';

// A day's label, read and written in UTC so the viewer's zone can't move an ET day
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// The day before a Y-m-d one, as Y-m-d
const dayBefore = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/*
	The latest day's picks marked as entered, one row a list, each with its goal mark and its game's start: the
	loaded day's once one is marked, and until then an earlier day's, whose late games can still be going after
	midnight. A section like the others, collapsed by its title; it shows the picks and nothing more, and a pick
	is marked in its list.
*/
export default function MyPicks(props: {
	date: string,
	// The day is the one the page loaded, rather than an earlier one
	today: boolean,
	// The day the page loaded, with or without games, or null when its lists failed to load
	loadedDate: string | null,
	picks: EnteredDay,
	// The day's scores, or null until they're read
	scores: DayScores | null,
	// Each of the day's teams' start, in ms, or null until it's known
	starts: ReadonlyMap<string, number> | null,
	darkTheme: boolean
}) {
	const { date, today, loadedDate, picks, scores, starts, darkTheme } = props;
	const title = today ? "Today's Picks"
		: loadedDate !== null && dayBefore(loadedDate) === date ? "Yesterday's Picks"
			: `Picks for ${dayLabel.format(new Date(`${date}T00:00:00Z`))}`;
	return (
		<CollapsibleSection title={title}>
			<div className="scrollable-table-wrapper section-container">
				<table className='my-picks-table'>
					<tbody>
						{PickTables.map((table) => {
							const pick = picks[table];
							const logo = pick ? (darkTheme ? pick.logoDark : pick.logoLight) : null;
							const start = pick ? starts?.get(pick.team) : undefined;
							return (
								<tr key={table}>
									<td className='my-picks-list'>#{table}</td>
									<td>
										{pick ? (
											<span className='cell-container'>
												<span className='cell-container cell-player'>
													{logo
														? <img className='td-name-logo' src={logo} alt='' onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
														: <span className='td-name-logo' />}
													{pick.name}
												</span>
												{scores && <GoalMark scores={scores} playerId={pick.playerId} team={pick.team} />}
											</span>
										) : (
											<span className='cell-container my-picks-none'>
												<span className='td-name-logo' />
												No pick
											</span>
										)}
									</td>
									<td className='my-picks-start'>{start !== undefined && startTime.format(start)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</CollapsibleSection>
	);
}
