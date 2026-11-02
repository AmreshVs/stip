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
