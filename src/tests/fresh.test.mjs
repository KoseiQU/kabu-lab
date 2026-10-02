// --if-stale の判定（digest を取り直す必要があるか）
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDigestFresh, lastCloseBefore } from '../collect/lib/util.mjs';

const jst = (s) => new Date(`${s}+09:00`);

test('直近の大引け: 平日の引け後は当日 15:45', () => {
  assert.equal(lastCloseBefore(jst('2026-10-02T18:00:00')).toISOString(), jst('2026-10-02T15:45:00').toISOString());
});
test('直近の大引け: 平日の引け前は前営業日 15:45', () => {
  assert.equal(lastCloseBefore(jst('2026-10-02T10:00:00')).toISOString(), jst('2026-10-01T15:45:00').toISOString());
});
test('直近の大引け: 土日と月曜の朝は金曜 15:45', () => {
  const fri = jst('2026-10-02T15:45:00').toISOString();
  assert.equal(lastCloseBefore(jst('2026-10-03T12:00:00')).toISOString(), fri);
  assert.equal(lastCloseBefore(jst('2026-10-04T23:00:00')).toISOString(), fri);
  assert.equal(lastCloseBefore(jst('2026-10-05T09:00:00')).toISOString(), fri);
});
test('引け後に作った digest は翌朝も最新', () => {
  assert.equal(isDigestFresh(jst('2026-10-02T16:00:00'), jst('2026-10-03T09:00:00')), true);
});
test('場中に作った digest は引け後には古い（3時間超）', () => {
  assert.equal(isDigestFresh(jst('2026-10-02T10:00:00'), jst('2026-10-02T16:00:00')), false);
});
test('作成から3時間以内なら場中でも取り直さない', () => {
  assert.equal(isDigestFresh(jst('2026-10-02T10:00:00'), jst('2026-10-02T12:30:00')), true);
});
test('前日の引け前に作った digest は古い', () => {
  assert.equal(isDigestFresh(jst('2026-10-01T14:00:00'), jst('2026-10-02T09:00:00')), false);
});
test('不正な日時・未来の日時は最新とみなさない', () => {
  assert.equal(isDigestFresh(new Date('x'), jst('2026-10-02T09:00:00')), false);
  assert.equal(isDigestFresh(jst('2026-10-03T09:00:00'), jst('2026-10-02T09:00:00')), false);
});
