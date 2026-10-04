import { type ReactNode } from 'react';
import './Popup.css';

interface PopupProps {
    showPopUp: boolean;
    title: string;
    closePopUp: () => void;
    children: ReactNode;
    top?: boolean;
    pinned?: ReactNode;
}

function Popup({ showPopUp, title, closePopUp, children, top, pinned }: PopupProps) {
    if (!showPopUp) {
        return null;
    }

    return (
        <div
            className={`popup-overlay${top ? ' popup-overlay-top' : ''}`}
            onClick={closePopUp}
        >
            <div
                className={`popup-content${top ? ' popup-content-top' : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="popup-header">
                    <span className="popup-header-title">{title}</span>
                    <button className="close-button" onClick={closePopUp} aria-label="Close">
                        &times;
                    </button>
                </div>
                {pinned && <div className="popup-pinned">{pinned}</div>}
                <div className="popup-body">
                    {children}
                </div>
            </div>
        </div>
    );
}

export default Popup;
