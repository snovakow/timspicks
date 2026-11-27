import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, dayTime, fullDay } from '../utility';

import './Calendar.css';

const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdayLetter = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
const weekdayName = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });

// The week starts on Sunday, as North American calendars do, so the weekday heads count on from one
const SUNDAY = Date.UTC(2023, 0, 1);
const WEEKDAYS = Array.from({ length: 7 }, (_, index) => SUNDAY + index * 24 * 60 * 60 * 1000);

// Arrow keys move a day either way, or a week up and down
const KEY_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

// A month as Y-m
const monthOf = (date: string): string => date.slice(0, 7);

const shiftMonth = (month: string, by: number): string => {
	const [year, index] = month.split('-').map(Number);
	return new Date(Date.UTC(year, index - 1 + by, 1)).toISOString().slice(0, 7);
};

// The month's days, as Y-m-d
const daysOf = (month: string): string[] => {
	const [year, index] = month.split('-').map(Number);
	const count = new Date(Date.UTC(year, index, 0)).getUTCDate();
	return Array.from({ length: count }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`);
};

/*
	A month at a time, from the archive's first day to the loaded day, where only the days the page has data for
	can be picked. Tab reaches one day of the grid, the day shown or the month's first that can be picked, and the
	arrow keys move from there to the next day that can be picked, into the next or previous month as they go.
*/
export default function Calendar(props: {
	// The archive's first day, which the months start from
	first: string,
	// The loaded day, which they end at
	last: string,
	// The day the page shows
	selected: string,
	// The days that can be picked
	days: ReadonlySet<string>,
	onSelect: (date: string) => void
}) {
	const { first, last, selected, days, onSelect } = props;
	const [month, setMonth] = useState(() => monthOf(selected));
	// The day the arrow keys last moved to, focused once its month shows
	const [focusDay, setFocusDay] = useState<string | null>(null);
	const grid = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (focusDay === null) return;
		grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
	}, [focusDay, month]);

	const monthDays = daysOf(month);
	const lead = new Date(dayTime(monthDays[0])).getUTCDay();
	const open = (day: string) => day >= first && day <= last && days.has(day);
	const tabDay = [focusDay, selected].find((day) => day !== null && monthOf(day) === month && open(day)) ?? monthDays.find(open);

	const move = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
		const step = KEY_STEPS[event.key];
		if (step === undefined) return;
		event.preventDefault();
		let next = addDays(day, step);
		while (next >= first && next <= last && !open(next)) next = addDays(next, step);
		if (!open(next)) return;
		setMonth(monthOf(next));
		setFocusDay(next);
	};

	return (
		<div className="calendar">
			<div className="calendar-nav">
				<button type="button" className="calendar-step" aria-label="Previous month"
					disabled={month <= monthOf(first)} onClick={() => setMonth(shiftMonth(month, -1))}>
					‹
				</button>
				<span className="calendar-month" aria-live="polite">{monthLabel.format(dayTime(monthDays[0]))}</span>
				<button type="button" className="calendar-step" aria-label="Next month"
					disabled={month >= monthOf(last)} onClick={() => setMonth(shiftMonth(month, 1))}>
					›
				</button>
			</div>
			<div className="calendar-grid" ref={grid}>
				{WEEKDAYS.map((time) => (
					<abbr key={time} className="calendar-weekday" title={weekdayName.format(time)}>{weekdayLetter.format(time)}</abbr>
				))}
				{lead > 0 && <span style={{ gridColumn: `span ${lead}` }} />}
				{monthDays.map((day) => {
					const classes = ['calendar-day'];
					if (day === last) classes.push('calendar-day-today');
					if (day === selected) classes.push('calendar-day-selected');
					return (
						<button key={day} type="button" data-day={day} className={classes.join(' ')}
							disabled={!open(day)}
							tabIndex={day === tabDay ? 0 : -1}
							aria-label={fullDay(day)}
							aria-current={day === last ? 'date' : undefined}
							aria-pressed={day === selected}
							onKeyDown={(event) => move(event, day)}
							onClick={() => onSelect(day)}>
							{Number(day.slice(8))}
						</button>
					);
				})}
			</div>
		</div>
	);
}
