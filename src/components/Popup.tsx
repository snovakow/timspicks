import { useRef, useEffect, type ReactNode } from 'react';
import './Popup.css';

interface PopupProps {
    showPopUp: boolean;
    title: string;
    closePopUp: () => void;
    children: ReactNode;
}

function Popup({ showPopUp, title, closePopUp, children }: PopupProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showPopUp) {
            // Restore body scrolling and remove scrollbar gutter
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
            return;
        }

        // Calculate scrollbar width to prevent layout shift
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

        // Prevent background scrolling by disabling body overflow
        document.body.style.overflow = 'hidden';
        // Reserve space for scrollbar gutter
        if (scrollbarWidth > 0) {
            document.body.style.paddingRight = `${scrollbarWidth}px`;
        }

        // Block scroll events on the overlay to prevent background scrolling on touch devices
        const preventDefault = (e: Event) => {
            e.preventDefault();
        };

        const overlay = overlayRef.current;
        if (overlay) {
            overlay.addEventListener('touchmove', preventDefault, { passive: false });
            overlay.addEventListener('wheel', preventDefault, { passive: false });
        }

        return () => {
            // Cleanup: restore body overflow on unmount
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
            if (overlay) {
                overlay.removeEventListener('touchmove', preventDefault);
                overlay.removeEventListener('wheel', preventDefault);
            }
        };
    }, [showPopUp]);

    if (!showPopUp) {
        return null;
    }

    return (
        <div
            ref={overlayRef}
            className="popup-overlay"
            onClick={closePopUp}
        >
            <div
                className="popup-content"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="popup-header">
                    {title}
                    <button className="close-button" onClick={closePopUp}>
                        &times;
                    </button>
                </div>
                <div className="popup-body">
                    {children}
                </div>
            </div>
        </div>
    );
}

export default Popup;
