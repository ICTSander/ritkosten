import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

/** One icon vocabulary: SF Symbols on iOS, Material Symbols on Android & web. */
const ICONS = {
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  pin: { ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' },
  location: { ios: 'location.fill', android: 'my_location', web: 'my_location' },
  clock: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  car: { ios: 'car.fill', android: 'directions_car', web: 'directions_car' },
  fuel: { ios: 'fuelpump.fill', android: 'local_gas_station', web: 'local_gas_station' },
  bolt: { ios: 'bolt.fill', android: 'bolt', web: 'bolt' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  back: { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  warning: { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' },
  offline: { ios: 'wifi.slash', android: 'wifi_off', web: 'wifi_off' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  swap: { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
  route: { ios: 'point.topleft.down.to.point.bottomright.curvepath', android: 'route', web: 'route' },
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  museum: { ios: 'building.columns', android: 'museum', web: 'museum' },
  city: { ios: 'building.2', android: 'location_city', web: 'location_city' },
  home: { ios: 'house', android: 'home', web: 'home' },
  walk: { ios: 'figure.walk', android: 'directions_walk', web: 'directions_walk' },
  train: { ios: 'train.side.front.car', android: 'train', web: 'train' },
  bus: { ios: 'bus.fill', android: 'directions_bus', web: 'directions_bus' },
  tram: { ios: 'tram.fill', android: 'tram', web: 'tram' },
  metro: { ios: 'tram.fill.tunnel', android: 'subway', web: 'subway' },
  ferry: { ios: 'ferry.fill', android: 'directions_boat', web: 'directions_boat' },
  transit: { ios: 'tram.fill', android: 'directions_transit', web: 'directions_transit' },
  map: { ios: 'map', android: 'map', web: 'map' },
  ticket: { ios: 'ticket', android: 'confirmation_number', web: 'confirmation_number' },
  person: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  chevronDown: { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' },
  live: { ios: 'dot.radiowaves.left.and.right', android: 'sensors', web: 'sensors' },
} satisfies Record<string, SymbolName>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  return (
    <SymbolView
      name={ICONS[name]}
      size={size}
      tintColor={color}
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
