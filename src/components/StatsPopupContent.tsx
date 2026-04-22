import type { LogLines } from '../statsCalculations';
import './StatsPopupContent.css';

interface StatsPopupContentProps {
	stats: LogLines;
}

export default function StatsPopupContent({ stats }: StatsPopupContentProps) {
	return (
		<div className="stats-layout">
			{stats.map((section, index) => {
				return (
					<div key={index} className="stats-section">
						{section.map((line, lineIndex) => {
							const classes = [];
							if (line.bold) classes.push('stats-bold');
							classes.push('stats-align-' + line.align);
							const classNames = classes.join(' ');
							return (
								<div className={classNames} key={lineIndex}>{line.text}</div>
							)
						})}
					</div>
				);
			})}
		</div>
	);
}