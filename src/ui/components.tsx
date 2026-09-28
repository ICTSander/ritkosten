import { router } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';
import { useReduceMotion } from './motion';
import { fonts, GUTTER, MAX_WIDTH, radius, space, type, usePalette } from './theme';

type TextVariant = keyof typeof type;

export function AppText({
  variant = 'body',
  color,
  style,
  ...rest
}: TextProps & { variant?: TextVariant; color?: string }) {
  const c = usePalette();
  return <Text {...rest} style={[type[variant], { color: color ?? c.text }, style]} />;
}

export function Screen({
  children,
  scroll = false,
  header,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const Body = scroll ? Animated.ScrollView : View;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top }}>{header}</View>
      <Body
        style={{ flex: 1 }}
        {...(scroll
          ? { contentContainerStyle: styles.content, keyboardShouldPersistTaps: 'handled' as const }
          : {})}>
        {scroll ? children : <View style={[styles.content, { flex: 1 }]}>{children}</View>}
      </Body>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>{footer}</View>
      ) : null}
    </View>
  );
}

export function Header({ title, onBack, right }: { title?: string; onBack?: (() => void) | false; right?: ReactNode }) {
  const back = onBack === false ? undefined : (onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/'))));
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {back ? <IconButton icon="back" label="Terug" onPress={back} /> : null}
      </View>
      {title ? (
        <AppText variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }} accessibilityRole="header">
          {title}
        </AppText>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'muted';
}) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: tone === 'muted' ? c.surfaceMuted : 'transparent', opacity: pressed ? 0.6 : 1 },
      ]}>
      <Icon name={icon} size={20} color={c.text} />
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'plain';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const c = usePalette();
  const bg = variant === 'primary' ? c.accent : variant === 'secondary' ? c.surface : 'transparent';
  const fg = variant === 'primary' ? c.onAccent : variant === 'secondary' ? c.text : c.accent;
  const edge = variant === 'primary' ? c.accentEdge : variant === 'secondary' ? c.edge : 'transparent';
  const inactive = disabled || loading;
  // Chunky "pressable" look: a darker bottom edge that flattens when you press.
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        variant === 'plain'
          ? { height: 44, borderBottomWidth: 0 }
          : {
              borderBottomColor: edge,
              borderBottomWidth: pressed && !inactive ? 1 : 5,
              marginTop: pressed && !inactive ? 4 : 0,
            },
        variant === 'secondary' && { borderWidth: 2, borderColor: c.separator, borderBottomColor: edge },
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed && variant === 'plain' ? 0.6 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={fg} /> : null}
          <AppText variant="headline" color={fg} style={{ fontFamily: fonts.black }}>
            {title}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: ViewStyle; padded?: boolean }) {
  const c = usePalette();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.surface, padding: padded ? space.lg : 0 },
        style,
      ]}>
      {children}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  icon,
  right,
  onPress,
  accessibilityLabel,
  first,
  onLongPress,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: PressableProps['onLongPress'];
  accessibilityLabel?: string;
  first?: boolean;
}) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surfaceMuted : 'transparent' }]}>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: c.accentSoft }]}>
          <Icon name={icon} size={18} color={c.accent} />
        </View>
      ) : null}
      <View style={[styles.rowBody, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.separator }]}>
        <View style={{ flex: 1 }}>
          <AppText variant="body" numberOfLines={1} style={{ fontFamily: fonts.semibold }}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="footnote" color={c.textSecondary} numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right}
      </View>
    </Pressable>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const c = usePalette();
  return (
    <AppText variant="footnote" color={c.textSecondary} style={[styles.sectionLabel, { fontFamily: fonts.bold }]} accessibilityRole="header">
      {children}
    </AppText>
  );
}

export function SearchField({
  icon = 'search',
  onClear,
  inputRef,
  ...props
}: TextInputProps & { icon?: IconName; onClear?: () => void; inputRef?: React.Ref<TextInput> }) {
  const c = usePalette();
  return (
    <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.accent, borderBottomColor: c.accentEdge }]}>
      <Icon name={icon} size={20} color={c.textSecondary} />
      <TextInput
        ref={inputRef}
        placeholderTextColor={c.textTertiary}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        {...props}
        style={[type.body, { flex: 1, color: c.text, paddingVertical: 0, outlineStyle: 'none' } as never]}
      />
      {onClear && props.value ? (
        <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel="Wis zoekopdracht" hitSlop={10}>
          <View style={[styles.clear, { backgroundColor: c.surfaceMuted }]}>
            <Icon name="close" size={12} color={c.textSecondary} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Banner({
  tone,
  icon,
  text,
  action,
}: {
  tone: 'warning' | 'error' | 'info';
  icon: IconName;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const c = usePalette();
  const fg = tone === 'warning' ? c.warning : tone === 'error' ? c.error : c.accent;
  const bg = tone === 'warning' ? c.warningSoft : tone === 'error' ? c.errorSoft : c.accentSoft;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="alert">
      <Icon name={icon} size={18} color={fg} />
      <AppText variant="callout" color={c.text} style={{ flex: 1 }}>
        {text}
      </AppText>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={8}>
          <AppText variant="callout" color={fg} style={{ fontFamily: fonts.semibold }}>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Pulsing placeholder block; static when Reduce Motion is on. */
export function Skeleton({ width, height, style }: { width: number | `${number}%`; height: number; style?: ViewStyle }) {
  const c = usePalette();
  const reduce = useReduceMotion();
  const opacity = useState(() => new Animated.Value(0.55))[0];
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduce]);
  return <Animated.View style={[{ width, height, borderRadius: 8, backgroundColor: c.surfaceMuted, opacity }, style]} />;
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c.accent : c.surface,
          borderColor: selected ? c.accent : c.separator,
          borderBottomColor: selected ? c.accentEdge : c.edge,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      {icon ? <Icon name={icon} size={14} color={selected ? c.onAccent : c.textSecondary} /> : null}
      <AppText variant="callout" color={selected ? c.onAccent : c.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const c = usePalette();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surfaceMuted }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: c.surfaceRaised, ...shadow }]}>
            <AppText variant="callout" color={active ? c.text : c.textSecondary}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const shadow = {
  boxShadow: '0px 1px 2px rgba(15,18,22,0.08), 0px 4px 12px rgba(15,18,22,0.06)',
} as ViewStyle;

export const styles = StyleSheet.create({
  content: { paddingHorizontal: GUTTER, paddingBottom: space.xxxl, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  footer: { paddingHorizontal: GUTTER, paddingTop: space.md, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: space.sm },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, maxWidth: MAX_WIDTH + 2 * space.sm, width: '100%', alignSelf: 'center' },
  headerSide: { width: 56 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  button: { height: 56, borderRadius: radius.button, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.xl },
  card: { borderRadius: radius.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, minHeight: 60 },
  rowIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: space.md },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingRight: space.lg, minHeight: 60 },
  sectionLabel: { marginTop: space.xxl, marginBottom: space.sm, marginLeft: space.lg },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 58, borderRadius: 18, borderWidth: 2, borderBottomWidth: 5, paddingHorizontal: space.lg },
  clear: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingHorizontal: space.lg, borderRadius: radius.input },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: space.lg, borderRadius: 14, borderWidth: 2, borderBottomWidth: 4 },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: radius.pill },
  segment: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
