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

        // Prevent horizontal scroll from passing through, and vertical bounce at edges
        const overlay = overlayRef.current;
        const popupBody = overlay?.querySelector('.popup-body') as HTMLElement | null;
        let lastY: number | undefined = undefined;
        let lastX: number | undefined = undefined;
        const handleTouchMove = (e: TouchEvent) => {
            if (!popupBody) return;
            const touch = e.touches[0];
            if (lastY === undefined) lastY = touch.clientY;
            if (lastX === undefined) lastX = touch.clientX;
            const deltaY = lastY - touch.clientY;
            const deltaX = lastX - touch.clientX;
            lastY = touch.clientY;
            lastX = touch.clientX;
            // Always prevent horizontal scroll from passing through
            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                e.preventDefault();
                return;
            }
            // For vertical scroll, only prevent if at edge
            if (popupBody.scrollHeight > popupBody.clientHeight) {
                const atTop = popupBody.scrollTop === 0;
                const atBottom = popupBody.scrollTop + popupBody.clientHeight >= popupBody.scrollHeight - 1;
                if ((atTop && deltaY < 0) || (atBottom && deltaY > 0)) {
                    e.preventDefault();
                }
            } else {
                // Not scrollable vertically, always prevent
                e.preventDefault();
            }
        };
        const resetTouch = () => { lastY = undefined; lastX = undefined; };
        if (popupBody) {
            popupBody.addEventListener('touchmove', handleTouchMove, { passive: false });
            popupBody.addEventListener('touchend', resetTouch, { passive: false });
            popupBody.addEventListener('touchcancel', resetTouch, { passive: false });
        }

        return () => {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.body.style.paddingRight = '';
            window.scrollTo(0, scrollY);
            if (popupBody) {
                popupBody.removeEventListener('touchmove', handleTouchMove);
                popupBody.removeEventListener('touchend', resetTouch);
                popupBody.removeEventListener('touchcancel', resetTouch);
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
