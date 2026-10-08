const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTargets } = require('../helpers/notifyTargets');

test('owned number → only the owner, even when the thread is assigned to someone else', () => {
  assert.deepEqual(pickTargets({ ownerAgentId: 5, assignedAgentId: 2 }), [5]);
  assert.deepEqual(pickTargets({ ownerAgentId: '5' }), [5]);
});

test('a number shared by several accounts notifies all of them', () => {
  assert.deepEqual(pickTargets({ ownerAgentIds: [7, 2], assignedAgentId: 5 }).sort(), [2, 7]);
  assert.deepEqual(pickTargets({ ownerAgentIds: ['2', 2, null] }), [2]);
  assert.deepEqual(pickTargets({ ownerAgentIds: [], routedAgentId: 3 }), [3]);
});

test('number routed to one agent counts as owned', () => {
  assert.deepEqual(pickTargets({ routedAgentId: '3', assignedAgentId: 2 }), [3]);
});

test('shared number → the assigned agent', () => {
  assert.deepEqual(pickTargets({ assignedAgentId: 2 }), [2]);
});

test('shared number, unassigned → everyone (null)', () => {
  assert.equal(pickTargets({}), null);
  assert.equal(pickTargets({ ownerAgentId: null, routedAgentId: 'ivr', assignedAgentId: undefined }), null);
  assert.equal(pickTargets({ assignedAgentId: 0 }), null);
});
