import type { LogStat } from '../statsCalculations';
import styles from './StatsPopupContent.module.css';

interface StatsPopupContentProps {
	stats: LogStat[];
}

export default function StatsPopupContent({ stats }: StatsPopupContentProps) {
	return (
		<div className={styles.layout}>
			{stats.map((stat, index) => {
				const className = [
					styles.section,
					stat.isTitle ? styles.sectionTitle : '',
				].filter(Boolean).join(' ');

				return (
					<div key={index} className={className + ' stat-align-' + (stat.align)}>
						{stat.lines.map((line, lineIndex) => (
							<div key={lineIndex}>{line}</div>
						))}
					</div>
				);
			})}
		</div>
	);
}