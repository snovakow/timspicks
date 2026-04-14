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

        // Prevent background scroll on iOS, even if popup content is not scrollable
        const overlay = overlayRef.current;
        const popupContent = overlay?.querySelector('.popup-content');
        const allowScroll = (el: HTMLElement | null, deltaY: number) => {
            if (!el) return false;
            if (el.scrollHeight <= el.clientHeight) return false;
            if (deltaY < 0 && el.scrollTop === 0) return false;
            if (deltaY > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight) return false;
            return true;
        };
        let lastY: number | undefined = undefined;
        const preventTouchMove = (e: TouchEvent) => {
            if (!popupContent) {
                e.preventDefault();
                return;
            }
            // Only allow scroll if the popup content can scroll in the direction
            const touch = e.touches[0];
            if (lastY === undefined) lastY = touch.clientY;
            const deltaY = lastY - touch.clientY;
            lastY = touch.clientY;
            if (!allowScroll(popupContent as HTMLElement, deltaY)) {
                e.preventDefault();
            }
        };
        const resetTouch = () => { lastY = undefined; };
        if (overlay) {
            overlay.addEventListener('touchmove', preventTouchMove, { passive: false });
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
                overlay.removeEventListener('touchmove', preventTouchMove);
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
