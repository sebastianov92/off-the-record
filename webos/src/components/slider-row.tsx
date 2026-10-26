// One adjustable row: the whole row takes focus, Left/Right change it, and the
// Magic Remote can click anywhere on the track.
interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  focused: boolean;
  disabled?: boolean;
  centered?: boolean; // a ± value such as an EQ band: the fill grows from the middle
  display?: string;
  onPick?: (value: number) => void;
  onHover?: () => void;
}

export function SliderRow({ label, value, min, max, focused, disabled, centered, display, onPick, onHover }: Props) {
  const ratio = (value - min) / (max - min);
  const zero = centered ? (0 - min) / (max - min) : 0;
  const fillLeft = Math.min(ratio, zero);
  const fillWidth = Math.abs(ratio - zero);
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !onPick) return;
    const box = event.currentTarget.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    onPick(Math.round(min + r * (max - min)));
  };
  return (
    <div
      className={`slider${focused ? ' is-focused' : ''}${disabled ? ' is-disabled' : ''}`}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onHover?.()}
    >
      <span className="slider-label">{label}</span>
      <div className="slider-track" onPointerDown={pick}>
        <div className="slider-fill" style={{ left: `${fillLeft * 100}%`, width: `${fillWidth * 100}%` }} />
        <div className="slider-thumb" style={{ left: `${ratio * 100}%` }} />
      </div>
      <span className="slider-value">{display ?? value}</span>
    </div>
  );
}
