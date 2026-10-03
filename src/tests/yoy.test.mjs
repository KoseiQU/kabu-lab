// 株探の前年比セル（「3.5倍」など）を％に直す
import test from 'node:test';
import assert from 'node:assert/strict';
import { yoyCellToPct } from '../collect/kabutan-finance.mjs';

test('「3.5倍」は +250%（3.5% と読まない）', () => {
  assert.equal(yoyCellToPct('3.5倍'), 250);
  assert.equal(yoyCellToPct('<td>4.6倍</td>'), 360);
  assert.equal(yoyCellToPct('２倍'), 100);
});
test('通常の％はそのまま', () => {
  assert.equal(yoyCellToPct('+10.9'), 10.9);
  assert.equal(yoyCellToPct('-15.0'), -15);
});
test('語や空は数値にしない', () => {
  assert.equal(yoyCellToPct('黒転'), null);
  assert.equal(yoyCellToPct('－'), null);
  assert.equal(yoyCellToPct(undefined), null);
});
