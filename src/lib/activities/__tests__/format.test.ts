import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, formatElevation, formatPace } from '../format';
import { chartSeries, paceSeries } from '../charts';
import { buildStream } from '../stream';
import { cleanPoints } from '../normalize';
import { line } from './fixtures';

describe('format', () => {
  it('reads distance, time and elevation in either unit', () => {
    expect(formatDistance(5000, 'km')).toBe('5.00 km');
    expect(formatDistance(1609.344, 'mi')).toBe('1.00 mi');
    expect(formatDistance(200_000, 'mi')).toBe('124 mi');
    expect(formatDistance(null, 'km')).toBe('—');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(725)).toBe('12:05');
    expect(formatDuration(45)).toBe('0:45');
    expect(formatElevation(100, 'km')).toBe('100 m');
    expect(formatElevation(100, 'mi')).toBe('328 ft');
  });

  it('gives each type its own speed reading', () => {
    expect(formatPace(5000, 1500, 'run', 'km')).toEqual({ label: 'Avg pace', value: '5:00 /km' });
    expect(formatPace(5000, 1500, 'run', 'mi').value).toBe('8:03 /mi');
    expect(formatPace(30_000, 3600, 'ride', 'km')).toEqual({ label: 'Avg speed', value: '30.0 km/h' });
    expect(formatPace(30_000, 3600, 'ride', 'mi').value).toBe('18.6 mph');
    expect(formatPace(1000, 1200, 'swim', 'km').value).toBe('2:00 /100m');
    expect(formatPace(0, 100, 'run', 'km').value).toBe('—');
  });
});

describe('chart series', () => {
  const stream = buildStream(cleanPoints({ format: 'gpx', type: 'run', name: null, points: line(600, { stepM: 3, hr: 150, climbPerStep: 0.05 }), device: {}, tzOffsetMin: null }));

  it('draws elevation, pace and heart rate for a run with all three', () => {
    const s = chartSeries(stream, 'run', 'km');
    expect(s.map(x => x.kind)).toEqual(['elevation', 'pace', 'hr']);
    expect(s[1]).toMatchObject({ title: 'Pace', invert: true });
  });

  it('reads 3 m/s as a 5:33 /km pace, a speed for a ride', () => {
    const p = paceSeries(stream, 'run', 'km');
    expect(p[300]).toBeCloseTo(1000 / 3, 0);
    const r = paceSeries(stream, 'ride', 'km');
    expect(r[300]).toBeCloseTo(10.8, 1);
  });

  it('draws nothing without a stream', () => {
    expect(chartSeries(null, 'run', 'km')).toEqual([]);
  });
});
