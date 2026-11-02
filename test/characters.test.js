const test = require('node:test');
const assert = require('node:assert/strict');
const characters = require('../src/renderer/shared/characters');

const drawn = characters.list.filter(({ id }) => characters.has(id));

test('six characters, and the orb stays a choice', () => {
  assert.equal(drawn.length, 6);
  assert.equal(characters.list[0].id, 'orb');
  assert.equal(characters.has('orb'), false);
});

test('every character draws at every fill', () => {
  for (const { id } of drawn) {
    for (let glasses = 0; glasses <= 8; glasses += 1) {
      const svg = characters.markup(id, characters.fillFor(glasses, 8));
      assert.match(svg, /char-wave/, id);
      assert.doesNotMatch(svg, /NaN|undefined"/, id);
      assert.doesNotMatch(svg, /style=/, `${id} would be blocked by the page's security policy`);
    }
  }
});

test('water rises as the fill goes up', () => {
  const rise = (id, fill) => Number(/translate\(0 (-?[\d.]+)\)/.exec(characters.markup(id, fill))[1]);
  for (const { id } of drawn) assert.ok(rise(id, 1) < rise(id, 0.5) && rise(id, 0.5) <= rise(id, 0), id);
});

test('fill stays between 0 and 1 past the goal', () => {
  assert.equal(characters.fillFor(0, 8), 0);
  assert.equal(characters.fillFor(4, 8), 0.5);
  assert.equal(characters.fillFor(12, 8), 1);
});

test('the coolant temperature falls with every glass', () => {
  const temp = (fill) => Number(/(\d+)°/.exec(characters.markup('coolant', fill))[1]);
  assert.equal(temp(0), 98);
  assert.equal(temp(1), 38);
  assert.ok(temp(0.5) < temp(0.25));
});

test('labels stay out of small drawings', () => {
  assert.match(characters.markup('duck', 0), /undefined/);
  assert.doesNotMatch(characters.markup('duck', 0, { small: true }), />undefined</);
});

const drawnIds = drawn.map(({ id }) => id);

test('every character has two unlocks, at 7 and 30 days', () => {
  for (const id of drawnIds) {
    assert.equal(characters.growth(id, 6).level, 0, id);
    assert.equal(characters.growth(id, 7).level, 1, id);
    assert.equal(characters.growth(id, 29).level, 1, id);
    assert.equal(characters.growth(id, 30).level, 2, id);
    assert.equal(characters.growth(id, 500).next, null, id);
  }
});

test('growth says what comes next', () => {
  assert.deepEqual(characters.growth('duck', 4).next, { days: 7, name: 'a hat', left: 3 });
  assert.deepEqual(characters.growth('duck', 7).earned, ['a hat']);
});

test('dust comes after a week, and never for someone brand new', () => {
  assert.equal(characters.growth('duck', 3, 6).neglected, false);
  assert.equal(characters.growth('duck', 3, 7).neglected, true);
  assert.equal(characters.growth('duck', 0, null).neglected, false);
});

test('dust never takes an unlock away', () => {
  assert.equal(characters.growth('duck', 30, 40).level, 2);
});

test('an unlock is announced once, on the day it happens', () => {
  assert.equal(characters.unlockedBetween('duck', 6, 7), 'a hat');
  assert.equal(characters.unlockedBetween('duck', 7, 7), null);
  assert.equal(characters.unlockedBetween('camel', 29, 30), 'a second hump');
  assert.equal(characters.unlockedBetween('orb', 6, 7), null);
});

test('every level draws, with and without dust, and changes the drawing', () => {
  for (const id of drawnIds) {
    const plain = characters.markup(id, 0.5);
    for (const level of [1, 2]) {
      const svg = characters.markup(id, 0.5, { level });
      assert.notEqual(svg, plain, `${id} level ${level}`);
      assert.doesNotMatch(svg, /NaN|undefined"|style=/, id);
    }
    assert.match(characters.markup(id, 0.5, { neglected: true }), /char-dusty/, id);
  }
});

test('the cactus flower stays from the second unlock, even with no water', () => {
  const hasFlower = (svg) => svg.includes('#fb7185');
  assert.equal(hasFlower(characters.markup('spike', 0)), false);
  assert.equal(hasFlower(characters.markup('spike', 0, { level: 2 })), true);
});
