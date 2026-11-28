import assert from 'node:assert/strict';
import { toDodoMinorUnits } from '../src/services/payments.js';

assert.equal(toDodoMinorUnits(1250, 'INR'), 125000, 'INR rupees convert to paise');
assert.equal(toDodoMinorUnits(19.99, 'USD'), 1999, 'USD dollars convert to cents');
assert.equal(toDodoMinorUnits(500, 'JPY'), 500, 'zero-decimal currencies stay in whole units');
assert.equal(toDodoMinorUnits(1.234, 'KWD'), 1234, 'three-decimal currencies convert to fils');
assert.throws(() => toDodoMinorUnits(0, 'INR'), /positive finite number/);
assert.throws(() => toDodoMinorUnits(-1, 'INR'), /positive finite number/);
assert.throws(() => toDodoMinorUnits(10.001, 'INR'), /unsupported precision/);
assert.throws(() => toDodoMinorUnits(1, 'INVALID'), /supported|ISO 4217/);

console.log('Dodo payment amount conversion checks passed.');
