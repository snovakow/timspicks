import type { CSSProperties } from 'react';
import { getEntries } from '../utility';
import type { LogStatsKey, SportsbookKey, LogLines } from '../dataTypes';
import { SportsbookKeys, Sportsbooks } from '../dataTypes';

import './StatsPopupContent.css';
import './sportsbook.css';

type SportsbookLog = Record<LogStatsKey, LogLines>

interface StatsPopupContentProps {
	bookStats: SportsbookLog | null;
	selectedKey: LogStatsKey;
	// The stats come from today's pick lists, so they go when the tables do
	locked: boolean;
}

interface StatsSportsbookListProps {
	selectedKey: LogStatsKey;
	onSelectKey: (key: LogStatsKey) => void;
}

const messageStats = (text: string): LogLines => [[
	{
		text,
		align: 'center',
		bold: true,
		title: true,
	}
]];

const emptyStats = messageStats('No stats available');
const lockedStats = messageStats('Picks are locked');

export default function StatsPopupContent({ bookStats, selectedKey, locked }: StatsPopupContentProps) {

	const display = locked ? lockedStats : bookStats?.[selectedKey] ?? emptyStats;
	return (
		<div className="stats-layout">
			{display.map((section, index) => (
				<div key={index} className="stats-section">
					{section.map((line, lineIndex) => {
						const classes = [];
						if (line.bold) classes.push('stats-bold');
						if (line.title) classes.push('stats-title');
						classes.push('stats-align-' + line.align);
						const classNames = classes.join(' ');
						return (
							<div className={classNames} key={lineIndex}>{line.text}</div>
						);
					})}
				</div>
			))}
		</div>
	);
}

export function StatsSportsbookList({ selectedKey, onSelectKey }: StatsSportsbookListProps) {
	return (
		<div className="sportsbook-list stats-sportsbook-list" style={{ '--book-count': SportsbookKeys.length } as CSSProperties}>
			{getEntries(Sportsbooks).map(([key, book]) => (
				<button
					key={key}
					type="button"
					className={`sportsbook-item${selectedKey === key ? ' sportsbook-selected' : ''}`}
					aria-label={book.title}
					onClick={() => onSelectKey(selectedKey === key ? 'betAvg' : key as SportsbookKey)}
				>
					{book.logo && <img className="sportsbook-logo sportsbook-logo-rounded" src={book.logo} alt={`${book.title} logo`} />}
					<span>{book.title}</span>
				</button>
			))}
		</div>
	);
}