import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export default function CollapsibleSection({ title, children, defaultOpen = true }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="collapsible-section">
      <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
        <div className="collapsible-header" aria-expanded={open} aria-controls={title.replace(/\s+/g, '-') + '-content'} style={{ width: 'fit-content' }}>
          <span
            className="collapsible-title"
            onClick={() => setOpen((v) => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', width: 'fit-content' }}
          >
            {title}
            <span className={open ? 'chevron chevron-down' : 'chevron chevron-right'} aria-hidden="true" />
          </span>
        </div>
      </div>
      <div
        id={title.replace(/\s+/g, '-') + '-content'}
        className={`collapsible-content${open ? ' open' : ''}`}
      >
        {children}
      </div>
    </section>
  );
}
