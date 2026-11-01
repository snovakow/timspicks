import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { getEntries } from '../utility';
import type { SportsbookKey, LogLines } from '../dataTypes';
import { SportsbookKeys, Sportsbooks } from '../dataTypes';

import './StatsPopupContent.css';
import './sportsbook.css';

// A passed slot's row: its start, a one-line summary, and the full stats it opens to, if it has any
export interface SlotStats {
	start: number;
	time: string;
	summary: string;
	stats: LogLines | null;
}

interface StatsPopupContentProps {
	stats: LogLines | null;
	// The day's last game has started, so no picks are left to make
	locked: boolean;
	// The passed slots, oldest first, while today's history is on
	slots: SlotStats[];
}

interface StatsSportsbookListProps {
	selected: ReadonlySet<SportsbookKey>;
	// add is true when the book joins or leaves the selection rather than replacing it
	onToggle: (key: SportsbookKey, add: boolean) => void;
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
const slotsTitle = messageStats('Earlier Slots');

function StatsLines({ stats }: { stats: LogLines }) {
	return (
		<>
			{stats.map((section, index) => (
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
		</>
	);
}

export default function StatsPopupContent({ stats, locked, slots }: StatsPopupContentProps) {
	const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
	const toggle = (start: number) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (!next.delete(start)) next.add(start);
			return next;
		});
	};

	// Once the day is locked, its slots are all there is to show
	const display = locked ? (slots.length > 0 ? null : lockedStats) : stats ?? emptyStats;
	return (
		<div className="stats-layout">
			{display && <StatsLines stats={display} />}
			{slots.length > 0 && (
				<>
					{!locked && <StatsLines stats={slotsTitle} />}
					{slots.map((slot) => {
						const open = slot.stats !== null && expanded.has(slot.start);
						return (
							<div key={slot.start} className="stats-slot">
								<button
									type="button"
									className="stats-slot-toggle"
									aria-expanded={open}
									disabled={slot.stats === null}
									onClick={() => toggle(slot.start)}
								>
									<span className={open ? 'chevron chevron-down' : 'chevron chevron-right'} aria-hidden="true" />
									<span className="stats-bold">{slot.time}</span>
									<span>{slot.summary}</span>
								</button>
								{open && slot.stats && <StatsLines stats={slot.stats} />}
							</div>
						);
					})}
				</>
			)}
		</div>
	);
}

// How long a press has to hold to add a book, and how far it can drift before it's a scroll instead
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 10;

/*
	A press held on a book does what Shift-click does, since a touch screen has no Shift: it toggles
	that book and leaves the others alone. The click that can follow the press is skipped, and the
	next press clears that, since some browsers send no click after a long press.
*/
export function StatsSportsbookList({ selected, onToggle }: StatsSportsbookListProps) {
	const press = useRef<{ timer: number; x: number; y: number } | null>(null);
	const skipClick = useRef(false);
	const [pulsed, setPulsed] = useState<SportsbookKey | null>(null);

	const cancelPress = () => {
		if (!press.current) return;
		window.clearTimeout(press.current.timer);
		press.current = null;
	};
	// A press still held when the popup closes mustn't change the selection after it's gone
	useEffect(() => cancelPress, []);

	const startPress = (key: SportsbookKey, event: PointerEvent<HTMLButtonElement>) => {
		cancelPress();
		skipClick.current = false;
		const timer = window.setTimeout(() => {
			press.current = null;
			skipClick.current = true;
			onToggle(key, true);
			setPulsed(key);
			navigator.vibrate?.(10);
		}, LONG_PRESS_MS);
		press.current = { timer, x: event.clientX, y: event.clientY };
	};

	const movePress = (event: PointerEvent<HTMLButtonElement>) => {
		if (!press.current) return;
		if (Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > LONG_PRESS_SLOP_PX) cancelPress();
	};

	return (
		<div className="sportsbook-list stats-sportsbook-list" style={{ '--book-count': SportsbookKeys.length } as CSSProperties}>
			{getEntries(Sportsbooks).map(([key, book]) => (
				<button
					key={key}
					type="button"
					className={`sportsbook-item${selected.has(key as SportsbookKey) ? ' sportsbook-selected' : ''}${pulsed === key ? ' sportsbook-pulse' : ''}`}
					aria-label={book.title}
					aria-pressed={selected.has(key as SportsbookKey)}
					onPointerDown={(event) => startPress(key as SportsbookKey, event)}
					onPointerMove={movePress}
					onPointerUp={cancelPress}
					onPointerLeave={cancelPress}
					onPointerCancel={cancelPress}
					onContextMenu={(event) => event.preventDefault()}
					onAnimationEnd={() => setPulsed(null)}
					onClick={(event) => {
						if (skipClick.current) {
							skipClick.current = false;
							return;
						}
						onToggle(key as SportsbookKey, event.shiftKey);
					}}
				>
					{book.logo && <img className="sportsbook-logo sportsbook-logo-rounded" src={book.logo} alt={`${book.title} logo`} draggable={false} />}
					<span>{book.title}</span>
				</button>
			))}
		</div>
	);
}
