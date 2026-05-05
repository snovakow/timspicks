import { useState } from 'react';

import { getEntries } from '../utility';
import type { LogStatsKey, SportsbookKey, LogLines } from '../sportsbookTypes';
import { sportsbooks } from '../sportsbookTypes';

import './StatsPopupContent.css';
import './sportsbook.css';

type SportsbookLog = Record<LogStatsKey, LogLines>

interface StatsPopupContentProps {
	bookStats: SportsbookLog | null;
}

const emptyStats: LogLines = [[
	{
		text: 'No stats available',
		align: 'center',
		bold: true,
		title: true,
	}
]];

export default function StatsPopupContent({ bookStats }: StatsPopupContentProps) {
	const [selectedKey, setSelectedKey] = useState<LogStatsKey>('betAvg');

	const display = bookStats?.[selectedKey] ?? emptyStats;
	return (
		<>
			{(bookStats && <div className="sportsbook-list">
				{getEntries(sportsbooks).map(([key, book]) => (
					<button
						key={key}
						type="button"
						className={`sportsbook-item${selectedKey === key ? ' sportsbook-selected' : ''}`}
						aria-label={book.title}
						onClick={() => setSelectedKey(selectedKey === key ? 'betAvg' : key as SportsbookKey)}
					>
						<img className="sportsbook-logo sportsbook-logo-rounded" src={book.logo} alt={`${book.title} logo`} />
						<span>{book.title}</span>
					</button>
				))}
			</div>)}
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
		</>
	);
}