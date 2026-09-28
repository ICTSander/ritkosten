import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { splitEuroCents } from '../domain/format';
import { AppText } from './components';
import { easeOut, useReduceMotion } from './motion';
import { fonts, type, usePalette } from './theme';

/**
 * The hero number. Counts up like a fuel-pump display (monospace digits keep the width
 * steady while they roll). Reduce Motion → shows the final value immediately.
 */
export function PriceCounter({
  cents,
  duration = 750,
  size = 64,
  delay = 0,
  prefix,
}: {
  cents: number;
  duration?: number;
  /** Font size of the euro digits. */
  size?: number;
  delay?: number;
  /** e.g. "≈" for estimates. */
  prefix?: string;
}) {
  const c = usePalette();
  const reduce = useReduceMotion();
  const [animated, setAnimated] = useState(0);
  const fromRef = useRef(0);
  const shown = reduce ? cents : animated;

  useEffect(() => {
    if (reduce) {
      fromRef.current = cents;
      return;
    }
    const from = fromRef.current;
    const start = Date.now() + delay;
    let frame: ReturnType<typeof requestAnimationFrame>;
    const tick = () => {
      const t = Math.max(0, Math.min(1, (Date.now() - start) / duration));
      const v = Math.round(from + (cents - from) * easeOut(t));
      setAnimated(v);
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = cents;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      fromRef.current = cents;
    };
  }, [cents, duration, reduce, delay]);

  const { euros, cents: ct } = splitEuroCents(shown);
  const final = splitEuroCents(cents);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${prefix ? 'ongeveer ' : ''}${final.euros} euro ${final.cents}`}
      style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <AppText
        style={[type.title, { fontFamily: fonts.mono, fontSize: size * 0.34, lineHeight: size * 0.5, marginTop: size * 0.18, marginRight: 4 }]}
        color={c.textSecondary}>
        {prefix ? `${prefix} €` : '€'}
      </AppText>
      <AppText
        style={[type.price, { fontSize: size, lineHeight: size * 1.12, letterSpacing: -size / 32 }]}
        adjustsFontSizeToFit
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}>
        {euros}
      </AppText>
      <AppText
        style={[type.price, { fontSize: size * 0.56, lineHeight: size * 0.7, marginTop: size * 0.09, letterSpacing: -1 }]}
        maxFontSizeMultiplier={1.4}>
        ,{ct}
      </AppText>
    </View>
  );
}
