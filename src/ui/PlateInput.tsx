import { StyleSheet, TextInput, View } from 'react-native';

import { formatPlate, normalizePlate } from '../services/rdw';
import { AppText } from './components';
import { fonts, radius, usePalette } from './theme';

/** Kenteken input styled as a Dutch number plate — the object every driver recognises. */
export function PlateInput({
  value,
  onChangeText,
  onSubmit,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
}) {
  const c = usePalette();
  const normalized = normalizePlate(value);
  const display = normalized.length === 6 ? formatPlate(normalized) : value.toUpperCase();

  return (
    <View style={[styles.plate, { backgroundColor: c.plate, borderColor: c.plateInk }]}>
      <View style={[styles.eu, { backgroundColor: c.plateBlue }]} accessibilityElementsHidden importantForAccessibility="no">
        <View style={styles.stars} />
        <AppText variant="caption" color="#FFFFFF" style={{ fontFamily: fonts.bold, fontSize: 11 }}>
          NL
        </AppText>
      </View>
      <TextInput
        value={display}
        onChangeText={(t) => onChangeText(t.toUpperCase().replace(/[^A-Z0-9-]/gi, '').slice(0, 8))}
        onSubmitEditing={onSubmit}
        placeholder="AB-123-C"
        placeholderTextColor="rgba(17,17,17,0.2)"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        maxLength={8}
        returnKeyType="search"
        accessibilityLabel="Kenteken"
        style={[styles.input, { color: c.plateInk, outlineStyle: 'none' } as never]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    flexDirection: 'row',
    height: 60,
    borderRadius: radius.plate,
    borderWidth: 2,
    overflow: 'hidden',
  },
  eu: { width: 34, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8, gap: 6 },
  stars: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#F4C400', borderStyle: 'dotted' },
  input: {
    flex: 1,
    fontFamily: fonts.monoBold,
    fontSize: 28,
    letterSpacing: 3,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
