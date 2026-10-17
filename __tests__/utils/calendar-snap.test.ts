import {computeSnap} from '../../src/utils/calendar-snap';

describe('computeSnap', () => {
  const period = 3;
  const dayBuffer = 10;

  it('ровно на дне: daysMoved=0, targetX — база смещения', () => {
    const dayW = 100;
    const baseX = -(dayBuffer * dayW);
    const snap = computeSnap(baseX, dayW, period, dayBuffer);
    expect(snap).toEqual({daysMoved: 0, targetX: baseX});
  });

  it('ровно на дне со сдвигом вправо: daysMoved соответствует количеству дней', () => {
    const dayW = 100;
    const snap = computeSnap(-(dayBuffer + 2) * dayW, dayW, period, dayBuffer);
    expect(snap).toEqual({daysMoved: 2, targetX: -(dayBuffer + 2) * dayW});
  });

  it('полдня вправо: округление к ближайшему дню (вверх)', () => {
    const dayW = 100;
    const snap = computeSnap(-(dayBuffer * dayW) - 50, dayW, period, dayBuffer);
    expect(snap).toEqual({daysMoved: 1, targetX: -(dayBuffer + 1) * dayW});
  });

  it('полдня влево: округление к ближайшему дню (к базе)', () => {
    const dayW = 100;
    const snap = computeSnap(-(dayBuffer * dayW) + 50, dayW, period, dayBuffer);
    expect(snap).toEqual({daysMoved: 0, targetX: -(dayBuffer * dayW)});
  });

  it('меньше половины дня влево: остаёмся на текущем дне', () => {
    const dayW = 100;
    const snap = computeSnap(-(dayBuffer * dayW) + 49, dayW, period, dayBuffer);
    expect(snap).toEqual({daysMoved: 0, targetX: -(dayBuffer * dayW)});
  });

  it('clamp левой границы: X за правым краем полосы не уводит раньше первого дня', () => {
    const dayW = 100;
    const snap = computeSnap(500, dayW, period, dayBuffer);
    expect(snap).toEqual({daysMoved: -dayBuffer, targetX: 0});
  });

  it('clamp правой границы: X за левым краем полосы не уводит дальше последнего дня', () => {
    const dayW = 100;
    const stripLen = period + 2 * dayBuffer;
    const beyond = -(stripLen + 5) * dayW;
    const snap = computeSnap(beyond, dayW, period, dayBuffer);
    expect(snap).toEqual({daysMoved: stripLen - period - dayBuffer, targetX: -(stripLen - period) * dayW});
  });

  it('работает с нецелым dayW (период 3/7 на узком экране)', () => {
    const dayW = 97.5;
    const snap = computeSnap(-(dayBuffer * dayW) - 1.5 * dayW, dayW, period, dayBuffer);
    expect(snap.daysMoved).toBe(2);
    expect(snap.targetX).toBeCloseTo(-(dayBuffer + 2) * dayW, 10);
  });
});
