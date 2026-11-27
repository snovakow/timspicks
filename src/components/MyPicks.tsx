import CollapsibleSection from './CollapsibleSection';
import { GoalMark } from './Table';
import type { DayScores } from '../dataProcessor';
import { PickTables, type EnteredDay } from '../enteredPicks';
import { startTime } from '../utility';

import './MyPicks.css';

/*
	The shown day's picks marked as entered, one row a list, each with its goal mark and its game's start: the
	loaded day's, or the day before's when the calendar shows it, the only two days whose picks are kept. A
	section like the others, collapsed by its title; it shows the picks and nothing more, and a pick is marked in
	its list.
*/
export default function MyPicks(props: {
	// The picks are the day before the loaded day's, rather than the loaded day's own
	yesterday: boolean,
	picks: EnteredDay,
	// The day's scores, or null until they're read
	scores: DayScores | null,
	// Each of the day's teams' start, in ms, or null until it's known
	starts: ReadonlyMap<string, number> | null,
	darkTheme: boolean
}) {
	const { yesterday, picks, scores, starts, darkTheme } = props;
	return (
		<CollapsibleSection title={yesterday ? "Yesterday's Picks" : "Today's Picks"}>
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
