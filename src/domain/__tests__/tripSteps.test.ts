import { mapMotisItinerary } from '../../services/transit/transitous';
import fixture from '../../services/__tests__/fixtures/transitous-heerlen-amsterdam.json';
import { planTripAlerts } from '../../services/tripAlerts';
import { trainTypeInfo } from '../trainTypes';
import { buildTripSteps, currentStepIndex, formatCountdown, tripProgress } from '../tripSteps';

// Recorded journey: walk 609 m → NS Intercity Heerlen (spoor 5) → Amsterdam Centraal (7a) → walk 460 m
const journey = mapMotisItinerary(fixture.itineraries[0] as never, 0);
const at = (iso: string) => Date.parse(iso);

describe('trip steps', () => {
  const steps = buildTripSteps(journey, 'Rijksmuseum');

  it('turns the journey into do-this-now steps', () => {
    expect(steps.map((s) => s.kind)).toEqual(['before', 'walk', 'board', 'ride', 'walk', 'arrived']);
    expect(steps[1]).toMatchObject({ title: 'Loop naar spoor 5', platform: '5', countdownLabel: 'tot de trein vertrekt' });
    expect(steps[2]).toMatchObject({ title: 'Stap in: Intercity', subtitle: 'richting Enkhuizen · Heerlen' });
    expect(steps[3]).toMatchObject({ title: 'Uitstappen in Amsterdam Centraal', platform: '7a' });
    expect(steps[4].title).toBe('Loop naar Rijksmuseum');
    expect(steps[5].title).toBe('Je bent er!');
  });

  it('counts the walk down to the train departure, not to the end of the walk', () => {
    expect(steps[1].deadline).toBe(at('2026-09-29T07:49:00Z'));
  });

  it('picks the active step by time', () => {
    expect(currentStepIndex(steps, at('2026-09-29T07:00:00Z'))).toBe(0); // before leaving
    expect(currentStepIndex(steps, at('2026-09-29T07:41:00Z'))).toBe(1); // walking
    expect(currentStepIndex(steps, at('2026-09-29T07:48:00Z'))).toBe(1); // still walking (walk ends at departure)
    expect(currentStepIndex(steps, at('2026-09-29T09:00:00Z'))).toBe(3); // on the train
    expect(currentStepIndex(steps, at('2026-09-29T11:00:00Z'))).toBe(5); // arrived
  });

  it('applies live delays to later steps', () => {
    const late = buildTripSteps(journey, 'Rijksmuseum', { 1: 7 });
    expect(late[2].deadline - steps[2].deadline).toBe(7 * 60_000);
    expect(late[3].deadline - steps[3].deadline).toBe(7 * 60_000);
  });

  it('reports progress through the journey', () => {
    expect(tripProgress(journey, at('2026-09-29T07:00:00Z'))).toBe(0);
    expect(tripProgress(journey, at('2026-09-29T12:00:00Z'))).toBe(1);
    const mid = tripProgress(journey, at('2026-09-29T09:01:00Z'));
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it('formats the countdown', () => {
    expect(formatCountdown(194_000)).toBe('3:14');
    expect(formatCountdown(3_750_000)).toBe('1 u 2 min');
    expect(formatCountdown(7_200_000)).toBe('2 u');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});


describe('train type facts', () => {
  it('matches NS API type strings (longest prefix wins)', () => {
    expect(trainTypeInfo('VIRMm1 IV')?.code).toBe('VIRM');
    expect(trainTypeInfo('Flirt 2 ARR')?.code).toBe('FLIRT_ARR');
    expect(trainTypeInfo('FLIRT')?.code).toBe('FLIRT');
    expect(trainTypeInfo('ICM')?.code).toBe('ICM');
    expect(trainTypeInfo('ICNG-B')?.code).toBe('ICNG');
    expect(trainTypeInfo('UNKNOWN')).toBeUndefined();
    expect(trainTypeInfo(undefined)).toBeUndefined();
  });
});


jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), SchedulableTriggerInputTypes: { DATE: 'date' } }));

describe('trip alerts', () => {
  const steps = buildTripSteps(journey, 'Rijksmuseum');
  it('vibrates 3 min before boarding, 2 min before getting off and at the stop', () => {
    const alerts = planTripAlerts(steps, at('2026-09-29T07:00:00Z'));
    expect(alerts.map((a) => [new Date(a.at).toISOString(), a.title])).toEqual([
      ['2026-09-29T07:46:00.000Z', 'Stap in: Intercity over 3 min'],
      ['2026-09-29T10:13:00.000Z', 'Bijna uitstappen'],
      ['2026-09-29T10:15:00.000Z', 'Stap nu uit'],
    ]);
    expect(alerts[1].body).toBe('Amsterdam Centraal over 2 min · spoor 7a');
  });

  it('skips alerts in the past', () => {
    expect(planTripAlerts(steps, at('2026-09-29T10:14:00Z')).map((a) => a.title)).toEqual(['Stap nu uit']);
  });
});
