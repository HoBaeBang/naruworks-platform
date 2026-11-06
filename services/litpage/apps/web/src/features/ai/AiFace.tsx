import type { CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';

export function FaceGlyph({ size = 20, strokeWidth }: { size?: number; strokeWidth?: number }) {
  return <Sparkles size={size} strokeWidth={strokeWidth ?? (size <= 20 ? 1.75 : 1.6)} style={{ display: 'block', flexShrink: 0 }} aria-hidden />;
}

/** Round avatar used by the floating AI button and chat landing hero. */
export function AiFaceAvatar({ size = 40, style }: { size?: number; style?: CSSProperties }) {
  return (
    <div className="nc-ai-face-avatar" style={{ width: size, height: size, ...style }}>
      <Sparkles size={Math.round(size * 0.62)} strokeWidth={size >= 56 ? 1.15 : 1.3} style={{ display: 'block', flexShrink: 0 }} aria-hidden />
    </div>
  );
}
