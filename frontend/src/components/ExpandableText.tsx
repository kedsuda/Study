import { useEffect, useId, useRef, useState } from 'react';

interface ExpandableTextProps {
  text: string;
  className?: string;
}

export const ExpandableText = ({ text, className = '' }: ExpandableTextProps) => {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const contentId = useId();

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  useEffect(() => {
    const element = textRef.current;
    if (!element || expanded) return;

    const checkOverflow = () => {
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    };
    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className="min-w-0">
      <p
        ref={textRef}
        id={contentId}
        className={`whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-6'} ${className}`}
      >
        {text}
      </p>
      {canExpand && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={event => {
            event.stopPropagation();
            setExpanded(value => !value);
          }}
          onKeyDown={event => event.stopPropagation()}
          className="mt-2 rounded-lg px-2 py-1 text-sm font-semibold text-[color:var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {expanded ? 'ดูน้อยลง' : 'ดูเพิ่มเติม'}
        </button>
      )}
    </div>
  );
};
