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

        // Block all scrolling on overlay unless popup-body is scrollable and gesture is allowed
        const overlay = overlayRef.current;
        let lastY: number | undefined = undefined;
        let lastX: number | undefined = undefined;
        const handleTouchMove = (e: TouchEvent) => {
            const popupBody = overlay?.querySelector('.popup-body') as HTMLElement | null;
            if (!popupBody) {
                e.preventDefault();
                return;
            }
            const touch = e.touches[0];
            if (lastY === undefined) lastY = touch.clientY;
            if (lastX === undefined) lastX = touch.clientX;
            const deltaY = lastY - touch.clientY;
            const deltaX = lastX - touch.clientX;
            lastY = touch.clientY;
            lastX = touch.clientX;
            // Always block horizontal scroll gestures
            if (Math.abs(deltaX) > 0) {
                e.preventDefault();
                return;
            }
            // If popup-body is not scrollable vertically, always block
            if (popupBody.scrollHeight <= popupBody.clientHeight) {
                e.preventDefault();
                return;
            }
            // For vertical scroll, only allow if not at edge
            const atTop = popupBody.scrollTop === 0;
            const atBottom = popupBody.scrollTop + popupBody.clientHeight >= popupBody.scrollHeight - 1;
            if ((atTop && deltaY < 0) || (atBottom && deltaY > 0)) {
                e.preventDefault();
            }
            // Otherwise, allow native vertical scroll
        };
        const resetTouch = () => { lastY = undefined; lastX = undefined; };
        if (overlay) {
            overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
            overlay.addEventListener('touchend', resetTouch, { passive: false });
            overlay.addEventListener('touchcancel', resetTouch, { passive: false });
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
            if (overlay) {
                overlay.removeEventListener('touchmove', handleTouchMove);
                overlay.removeEventListener('touchend', resetTouch);
                overlay.removeEventListener('touchcancel', resetTouch);
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
