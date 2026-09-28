import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { formatDecimal, parseDecimalInput } from '../domain/format';
import { AppText } from './components';
import { fonts, radius, space, usePalette } from './theme';

/**
 * Numeric input with −/+ buttons. Accepts "6,5" and "6.5".
 * Calls onChange only with valid numbers inside [min, max].
 */
export function NumberStepper({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  decimals = 1,
  unit,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  min: number;
  max: number;
  decimals?: number;
  unit: string;
  label: string;
}) {
  const c = usePalette();
  const [text, setText] = useState(value !== null ? formatDecimal(value, decimals) : '');
  const parsed = parseDecimalInput(text);
  const invalid = text !== '' && (!Number.isFinite(parsed) || parsed < min || parsed > max);

  const commit = (t: string) => {
    setText(t);
    const n = parseDecimalInput(t);
    onChange(Number.isFinite(n) && n >= min && n <= max ? n : null);
  };
  const bump = (dir: 1 | -1) => {
    const base = Number.isFinite(parsed) ? parsed : (value ?? min);
    const next = Math.min(max, Math.max(min, Math.round((base + dir * step) * 10 ** decimals) / 10 ** decimals));
    commit(formatDecimal(next, decimals));
  };

  return (
    <View style={{ gap: space.xs }}>
      <View style={[styles.wrap, { backgroundColor: c.surfaceMuted, borderColor: invalid ? c.error : 'transparent' }]}>
        <StepButton label={`${label} verlagen`} text="−" onPress={() => bump(-1)} />
        <View style={styles.center}>
          <TextInput
            value={text}
            onChangeText={commit}
            keyboardType="decimal-pad"
            placeholder="0,0"
            placeholderTextColor={c.textTertiary}
            accessibilityLabel={`${label}, in ${unit}`}
            style={[styles.input, { color: c.text, outlineStyle: 'none' } as never]}
          />
          <AppText variant="callout" color={c.textSecondary}>
            {unit}
          </AppText>
        </View>
        <StepButton label={`${label} verhogen`} text="+" onPress={() => bump(1)} />
      </View>
      {invalid ? (
        <AppText variant="footnote" color={c.error}>
          Vul een waarde tussen {formatDecimal(min, decimals)} en {formatDecimal(max, decimals)} in.
        </AppText>
      ) : null}
    </View>
  );
}

function StepButton({ text, label, onPress }: { text: string; label: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.step, { backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 }]}>
      <AppText variant="title" color={c.accent}>
        {text}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.input, padding: 6, borderWidth: 1.5 },
  center: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6 },
  input: { fontFamily: fonts.monoBold, fontSize: 28, minWidth: 70, textAlign: 'right', paddingVertical: 4 },
  step: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
