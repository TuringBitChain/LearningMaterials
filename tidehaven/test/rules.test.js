import assert from "node:assert/strict";
import test from "node:test";
import {
  CENTER,
  MAX_OFFLINE_MS,
  UPKEEP_MS,
  build,
  createGame,
  salvage,
  tick,
} from "../src/rules.js";

function scripted(values) {
  let index = 0;
  return () => {
    const value = values[index] ?? values.at(-1) ?? 0;
    index += 1;
    return value;
  };
}

test("a new raft sits in the middle with enough scrap to raise a collector", () => {
  const state = createGame(0);
  assert.equal(state.grid[CENTER][CENTER].type, "raft");
  const placed = build(state, CENTER, CENTER - 1, "collector", 0);
  assert.equal(placed.ok, true);
  assert.equal(placed.state.resources.plank, 2);
  assert.equal(placed.state.resources.rope, 1);
  assert.equal(placed.state.grid[CENTER - 1][CENTER].type, "collector");
});

test("buildings have to touch the raft and cannot stack", () => {
  const state = createGame(0);
  const isolated = build(state, 0, 0, "workshop", 0);
  assert.equal(isolated.reason, "isolated");
  assert.equal(isolated.state, state);
  const occupied = build(state, CENTER, CENTER, "workshop", 0);
  assert.equal(occupied.reason, "occupied");
});

test("a poor build does not spend resources", () => {
  const state = createGame(0);
  state.resources = { ...state.resources, plank: 0 };
  const result = build(state, CENTER, CENTER - 1, "collector", 0);
  assert.equal(result.reason, "poor");
  assert.equal(result.state, state);
});

test("salvage waits out the cooldown and a shark keeps the haul", () => {
  const shark = salvage(createGame(0), 0, scripted([0]));
  assert.equal(shark.shark, true);
  assert.equal(shark.state.resources.plank, 8);
  const again = salvage(shark.state, 1_000, scripted([0.9, 0]));
  assert.equal(again.reason, "cooldown");
  assert.equal(again.state, shark.state);
});

test("a calm haul adds loot, and a boat brings back an extra plank", () => {
  const calm = salvage(createGame(0), 0, scripted([0.5, 0]));
  assert.deepEqual(calm.gain, { plank: 3 });
  assert.equal(calm.state.resources.plank, 11);

  let withBoat = createGame(0);
  withBoat = {
    ...withBoat,
    resources: { ...withBoat.resources, plank: 30, metal: 10, rope: 10 },
  };
  withBoat = build(withBoat, CENTER, CENTER - 1, "boat", 0).state;
  const hauled = salvage(withBoat, 0, scripted([0.5, 0]));
  assert.equal(hauled.gain.plank, 4);
  assert.equal(hauled.shark, false);
});

test("stepped ticks match one jump, and food made on the same beat can be eaten", () => {
  let jumped = build(createGame(0), CENTER, CENTER - 1, "fishery", 0).state;
  let stepped = structuredClone(jumped);
  jumped = tick(jumped, 40_000).state;
  for (let at = 1_000; at <= 40_000; at += 1_000) stepped = tick(stepped, at).state;
  assert.deepEqual(stepped.resources, jumped.resources);

  let tight = build(createGame(0), CENTER, CENTER - 1, "fishery", 0).state;
  tight.resources.fish = 1;
  tight.resources.water = 5;
  tight.lastUpkeepAt = 8_000 - UPKEEP_MS;
  const fed = tick(tight, 8_000);
  assert.equal(fed.state.resources.fish, 2);
  assert.equal(fed.state.resources.water, 4);
});

test("hunger skips production, and time past the offline cap is not paid twice", () => {
  let hungry = build(createGame(0), CENTER, CENTER - 1, "collector", 0).state;
  hungry.resources.fish = 0;
  const skipped = tick(hungry, 8_000);
  assert.equal(skipped.state.resources.plank, 2);
  assert.ok(skipped.events.some((event) => event.kind === "starve"));

  let stocked = build(createGame(0), CENTER, CENTER - 1, "collector", 0).state;
  stocked.resources.fish = 100_000;
  stocked.resources.water = 100_000;
  const capped = tick(stocked, MAX_OFFLINE_MS).state;
  const later = tick(stocked, MAX_OFFLINE_MS + 86_400_000).state;
  assert.equal(later.resources.plank, capped.resources.plank);
  assert.equal(capped.resources.plank, 2 + MAX_OFFLINE_MS / 8_000);
});
