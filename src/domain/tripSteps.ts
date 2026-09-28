/**
 * Turns an itinerary into "what do I do now?" steps for the live trip screen:
 *   before → walk to the stop → board → ride (until you get off) → … → arrived.
 * Every step has a deadline to count down to. Pure and time-based, so it's easy to test;
 * the screen passes `now` and optional live delays per leg.
 */
import { formatNlClock } from './nlTime';
import type { Leg, LegMode, TransitItinerary } from './transit';

export type StepKind = 'before' | 'walk' | 'board' | 'ride' | 'arrived';

export interface TripStep {
  kind: StepKind;
  legIndex: number;
  /** Big instruction, e.g. "Loop naar spoor 5". */
  title: string;
  subtitle?: string;
  /** What the countdown means, e.g. "tot de trein vertrekt". */
  countdownLabel: string;
  platform?: string;
  platformWord?: 'spoor' | 'perron';
  startsAt: number; // ms
  deadline: number; // ms
}

const VEHICLE_WORD: Record<LegMode, string> = {
  walk: 'je',
  bus: 'de bus',
  tram: 'de tram',
  metro: 'de metro',
  train: 'de trein',
  ferry: 'de veerboot',
  other: 'het OV',
};

const platformWordFor = (leg: Leg): 'spoor' | 'perron' => (leg.mode === 'train' ? 'spoor' : 'perron');

function lineName(leg: Leg): string {
  const line = leg.line ?? '';
  if (leg.mode === 'train') return line || 'de trein';
  if (leg.mode === 'bus') return `bus ${line}`.trim();
  if (leg.mode === 'tram') return `tram ${line}`.trim();
  if (leg.mode === 'metro') return `metro ${line}`.trim();
  return line || VEHICLE_WORD[leg.mode];
}

/** Apply live delays (minutes, per leg index) on top of the planner's times. */
function times(leg: Leg, delayMin = 0) {
  const shift = delayMin * 60_000;
  const plannedShiftDep = Date.parse(leg.plannedDeparture) + shift;
  const plannedShiftArr = Date.parse(leg.plannedArrival) + shift;
  return {
    dep: Math.max(Date.parse(leg.departure), plannedShiftDep),
    arr: Math.max(Date.parse(leg.arrival), plannedShiftArr),
  };
}

export function buildTripSteps(
  it: Pick<TransitItinerary, 'legs'>,
  destinationLabel: string,
  delays: Record<number, number> = {},
): TripStep[] {
  const legs = it.legs;
  if (!legs.length) return [];
  const steps: TripStep[] = [];
  const first = legs[0];
  const firstVehicle = legs.find((l) => l.mode !== 'walk');
  const t0 = times(first, delays[0]);

  steps.push({
    kind: 'before',
    legIndex: 0,
    title: `Vertrek om ${formatNlClock(new Date(t0.dep).toISOString())}`,
    // An overview of the start — the next step already says where to walk to.
    subtitle:
      first.mode === 'walk'
        ? firstVehicle
          ? `Eerst ${Math.max(1, Math.round(first.durationMin))} min lopen, dan ${lineName(firstVehicle)} om ${formatNlClock(new Date(times(firstVehicle, delays[legs.indexOf(firstVehicle)]).dep).toISOString())}`
          : `${Math.max(1, Math.round(first.durationMin))} min lopen naar ${destinationLabel}`
        : `Stap in ${lineName(first)} richting ${first.headsign ?? first.to.name}`,
    countdownLabel: 'tot je moet vertrekken',
    startsAt: 0,
    deadline: t0.dep,
  });

  legs.forEach((leg, i) => {
    const t = times(leg, delays[i]);
    if (leg.mode === 'walk') {
      const next = legs[i + 1];
      const nextT = next ? times(next, delays[i + 1]) : null;
      const where = next?.from.platform
        ? `${platformWordFor(next)} ${next.from.platform}`
        : next?.from.name || leg.to.name || destinationLabel;
      const meters = leg.distanceMeters ? ` · ${Math.round(leg.distanceMeters / 10) * 10} m` : '';
      steps.push({
        kind: 'walk',
        legIndex: i,
        title: next ? `Loop naar ${where}` : `Loop naar ${destinationLabel}`,
        // Name the stop only when the title shows a platform ("Loop naar spoor 5 · Heerlen").
        subtitle: `${leg.durationMin} min lopen${meters}${next?.from.platform && next.from.name ? ` · ${next.from.name}` : ''}`,
        countdownLabel: next ? `tot ${VEHICLE_WORD[next.mode]} vertrekt` : 'tot aankomst',
        platform: next?.from.platform,
        platformWord: next ? platformWordFor(next) : undefined,
        startsAt: t.dep,
        deadline: nextT ? nextT.dep : t.arr,
      });
      return;
    }
    const prev = legs[i - 1];
    steps.push({
      kind: 'board',
      legIndex: i,
      title: `Stap in: ${lineName(leg)}`,
      subtitle: `richting ${leg.headsign ?? leg.to.name}${leg.from.name ? ` · ${leg.from.name}` : ''}`,
      countdownLabel: `tot ${VEHICLE_WORD[leg.mode]} vertrekt`,
      platform: leg.from.platform,
      platformWord: platformWordFor(leg),
      // After a walk: when you arrive at the stop. Otherwise: shortly before departure.
      startsAt: prev ? times(prev, delays[i - 1]).arr : t.dep - 5 * 60_000,
      deadline: t.dep,
    });
    steps.push({
      kind: 'ride',
      legIndex: i,
      title: `Uitstappen in ${leg.to.name || destinationLabel}`,
      subtitle: `${lineName(leg)} richting ${leg.headsign ?? leg.to.name}${leg.intermediateStops ? ` · ${leg.intermediateStops} tussenstops` : ''}`,
      countdownLabel: 'tot je moet uitstappen',
      platform: leg.to.platform,
      platformWord: platformWordFor(leg),
      startsAt: t.dep,
      deadline: t.arr,
    });
  });

  const last = legs[legs.length - 1];
  const tl = times(last, delays[legs.length - 1]);
  steps.push({
    kind: 'arrived',
    legIndex: legs.length - 1,
    title: 'Je bent er!',
    subtitle: destinationLabel,
    countdownLabel: '',
    startsAt: tl.arr,
    deadline: tl.arr,
  });

  // A step can't start before the previous one (keeps the order stable with odd data).
  for (let i = 1; i < steps.length; i++) steps[i].startsAt = Math.max(steps[i].startsAt, steps[i - 1].startsAt);
  return steps;
}

/** Index of the step that is active at `now` (the last one that has started). */
export function currentStepIndex(steps: TripStep[], now: number): number {
  let idx = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i].startsAt <= now) idx = i;
  return idx;
}

/** 0…1 progress through the journey by time (first departure → final arrival). */
export function tripProgress(it: Pick<TransitItinerary, 'legs'>, now: number, delays: Record<number, number> = {}): number {
  const legs = it.legs;
  if (!legs.length) return 0;
  const start = times(legs[0], delays[0]).dep;
  const end = times(legs[legs.length - 1], delays[legs.length - 1]).arr;
  if (end <= start) return now >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/** "3:14", "12:05" or "1:02:30" — negative becomes "0:00". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  // An hour or more away: ticking seconds only add stress, so show hours and minutes.
  if (h) return m ? `${h} u ${m} min` : `${h} u`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
