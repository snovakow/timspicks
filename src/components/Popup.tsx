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
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.documentElement.style.overflow = '';
            return;
        }

        // Calculate scrollbar width to prevent layout shift
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

        // Prevent background scrolling — position:fixed on body is required
        // for iOS Safari which ignores overflow:hidden on touch gestures
        const scrollY = window.scrollY;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        // Reserve space for scrollbar gutter
        if (scrollbarWidth > 0) {
            document.body.style.paddingRight = `${scrollbarWidth}px`;
        }

        // --- Remove custom touchmove preventDefault logic ---
        // Let .popup-body scroll natively on iOS

        return () => {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.body.style.paddingRight = '';
            window.scrollTo(0, scrollY);
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
                    <span className="popup-header-title">{title}</span>
                    <button className="close-button" onClick={closePopUp} aria-label="Close">
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
