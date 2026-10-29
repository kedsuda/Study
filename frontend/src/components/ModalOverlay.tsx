import { createContext, useContext, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

const ModalLayerContext = createContext(9990);

type ModalOverlayProps = HTMLAttributes<HTMLDivElement> & {
  layer?: number;
};

// Escape page stacking contexts and keep nested dialogs above their parent.
export const ModalOverlay = ({ children, className = '', style, layer = 10000, ...props }: ModalOverlayProps) => {
  const parentLayer = useContext(ModalLayerContext);
  const zIndex = Math.max(layer, parentLayer + 10);

  return createPortal(
    <ModalLayerContext.Provider value={zIndex}>
      <div
        role="dialog"
        aria-modal="true"
        {...props}
        className={`app-modal-overlay ${className}`}
        style={{ overflowY: 'auto', overscrollBehavior: 'contain', ...style, zIndex }}
      >
        {children}
      </div>
    </ModalLayerContext.Provider>,
    document.body
  );
};
