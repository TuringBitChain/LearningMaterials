export const GRID = 5;
export const CENTER = 2;
export const UPKEEP_MS = 20_000;
export const MAX_OFFLINE_MS = 2 * 60 * 60 * 1000;

export const RESOURCE_KEYS = ["plank", "metal", "plastic", "rope", "fish", "water"];

export const RESOURCE_LABELS = {
  plank: "木板",
  metal: "金属",
  plastic: "塑料",
  rope: "绳索",
  fish: "鱼获",
  water: "淡水",
};

export const BUILDINGS = {
  raft: {
    name: "木筏",
    blurb: "出发点。",
  },
  collector: {
    name: "收集器",
    blurb: "自己捞木板和塑料。",
    cost: { plank: 6, rope: 2 },
    every: 8_000,
    yield: { plank: 1, plastic: 1 },
  },
  fishery: {
    name: "切鱼台",
    blurb: "给岛民供鱼。",
    cost: { plank: 5, rope: 2 },
    every: 8_000,
    yield: { fish: 2 },
  },
  farm: {
    name: "浮田",
    blurb: "慢，但稳定出食物。",
    cost: { plank: 8, plastic: 2 },
    every: 10_000,
    yield: { fish: 1 },
  },
  still: {
    name: "海水提取",
    blurb: "把海水做成淡水。",
    cost: { metal: 4, plastic: 3 },
    every: 8_000,
    yield: { water: 2 },
  },
  workshop: {
    name: "工作台",
    blurb: "搓绳索。",
    cost: { plank: 4, metal: 2 },
    every: 10_000,
    yield: { rope: 1 },
  },
  boat: {
    name: "拾荒船",
    blurb: "出海更快，也更不容易被鲨鱼撞翻。",
    cost: { plank: 12, metal: 4, rope: 4 },
  },
};

const LOOT = [
  { w: 35, gain: { plank: 3 } },
  { w: 20, gain: { plank: 2, plastic: 1 } },
  { w: 15, gain: { metal: 2 } },
  { w: 12, gain: { rope: 2 } },
  { w: 10, gain: { fish: 2, water: 1 } },
  { w: 8, gain: { metal: 1, plastic: 2 } },
];

const BUILDABLE = Object.keys(BUILDINGS).filter((type) => type !== "raft");

export function createGame(now = 0) {
  const grid = Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => null));
  grid[CENTER][CENTER] = { type: "raft", level: 1, since: now, accruedUntil: now };
  return {
    resources: { plank: 8, metal: 3, plastic: 2, rope: 3, fish: 8, water: 8 },
    grid,
    lastSalvageAt: null,
    lastUpkeepAt: now,
    updatedAt: now,
    salvages: 0,
    sharkHits: 0,
  };
}

export function countBuildings(state, type) {
  let n = 0;
  for (const row of state.grid) {
    for (const cell of row) {
      if (cell && (type === undefined || cell.type === type)) n += 1;
    }
  }
  return n;
}

export function crewCount(state) {
  return countBuildings(state) - countBuildings(state, "raft");
}

export function salvageCooldown(state) {
  const boats = countBuildings(state, "boat");
  return Math.max(3_000, 6_000 - boats * 2_000);
}

export function sharkChance(state) {
  return countBuildings(state, "boat") > 0 ? 0.08 : 0.18;
}

export function cooldownLeft(state, now) {
  if (state.lastSalvageAt == null) return 0;
  return Math.max(0, salvageCooldown(state) - (now - state.lastSalvageAt));
}

export function canAfford(resources, cost = {}) {
  return RESOURCE_KEYS.every((key) => (resources[key] ?? 0) >= (cost[key] ?? 0));
}

export function isHungry(state) {
  return state.resources.fish <= 0 || state.resources.water <= 0;
}

function clone(state) {
  return structuredClone(state);
}

function add(resources, gain) {
  const next = { ...resources };
  for (const [key, amount] of Object.entries(gain)) {
    next[key] = (next[key] ?? 0) + amount;
  }
  return next;
}

function pay(resources, cost) {
  const next = { ...resources };
  for (const [key, amount] of Object.entries(cost)) {
    next[key] -= amount;
  }
  return next;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < GRID && y < GRID;
}

function adjacentToBuilt(grid, x, y) {
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  return neighbors.some(([nx, ny]) => inBounds(nx, ny) && grid[ny][nx]);
}

function rollLoot(rng) {
  let roll = Math.floor(rng() * 100);
  for (const entry of LOOT) {
    if (roll < entry.w) return entry.gain;
    roll -= entry.w;
  }
  return LOOT[0].gain;
}

export function salvage(state, now, rng = Math.random) {
  const wait = cooldownLeft(state, now);
  if (wait > 0) {
    return { ok: false, state, reason: "cooldown", wait, message: "船还在回来的路上" };
  }
  const next = clone(state);
  next.lastSalvageAt = now;
  next.updatedAt = now;
  next.salvages += 1;
  if (rng() < sharkChance(state)) {
    next.sharkHits += 1;
    return {
      ok: true,
      state: next,
      shark: true,
      gain: {},
      message: "鲨鱼顶翻了这一网，东西沉了",
    };
  }
  const gain = { ...rollLoot(rng) };
  if (countBuildings(state, "boat") > 0) gain.plank = (gain.plank ?? 0) + 1;
  next.resources = add(next.resources, gain);
  return { ok: true, state: next, shark: false, gain, message: "捞上来一批漂流物" };
}

export function build(state, x, y, type, now) {
  const spec = BUILDINGS[type];
  if (!spec || !BUILDABLE.includes(type)) {
    return { ok: false, state, reason: "unknown", message: "没有这种建筑" };
  }
  if (!inBounds(x, y)) {
    return { ok: false, state, reason: "bounds", message: "超出这块海域" };
  }
  if (state.grid[y][x]) {
    return { ok: false, state, reason: "occupied", message: "这里已经有建筑了" };
  }
  if (!adjacentToBuilt(state.grid, x, y)) {
    return { ok: false, state, reason: "isolated", message: "得挨着已有的浮岛" };
  }
  if (!canAfford(state.resources, spec.cost)) {
    return { ok: false, state, reason: "poor", message: "材料不够" };
  }
  const next = clone(state);
  next.resources = pay(next.resources, spec.cost);
  next.grid[y][x] = { type, level: 1, since: now, accruedUntil: now };
  next.updatedAt = now;
  return {
    ok: true,
    state: next,
    cost: { ...spec.cost },
    message: `${spec.name}立住了`,
  };
}

function hasCrew(state) {
  return crewCount(state) > 0;
}

function earliestEvents(state, cursor, limit) {
  let tMin = Infinity;
  const events = [];
  const consider = (t, event) => {
    if (t <= cursor || t > limit) return;
    if (t < tMin) {
      tMin = t;
      events.length = 0;
      events.push(event);
    } else if (t === tMin) {
      events.push(event);
    }
  };
  if (hasCrew(state)) consider(state.lastUpkeepAt + UPKEEP_MS, { kind: "upkeep" });
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const cell = state.grid[y][x];
      const every = cell && BUILDINGS[cell.type].every;
      if (!every) continue;
      consider(cell.accruedUntil + every, { kind: "produce", x, y });
    }
  }
  events.sort((a, b) => {
    if (a.kind === b.kind) return 0;
    return a.kind === "produce" ? -1 : 1;
  });
  if (events.length === 0) return null;
  return { t: tMin, events };
}

export function tick(state, now) {
  if (!Number.isFinite(now) || now <= state.updatedAt) {
    return { ok: true, state, events: [], message: "" };
  }
  const limit = Math.min(now, state.updatedAt + MAX_OFFLINE_MS);
  const next = clone(state);
  const events = [];
  let cursor = state.updatedAt;
  while (cursor < limit) {
    const batch = earliestEvents(next, cursor, limit);
    if (!batch) break;
    cursor = batch.t;
    for (const event of batch.events) {
      if (event.kind === "produce") {
        const cell = next.grid[event.y][event.x];
        const output = BUILDINGS[cell.type].yield;
        if (next.resources.fish > 0 && next.resources.water > 0) {
          next.resources = add(next.resources, output);
          events.push({ kind: "produce", type: cell.type, gain: output });
        } else {
          events.push({ kind: "starve", type: cell.type });
        }
        cell.accruedUntil += BUILDINGS[cell.type].every;
      } else {
        if (next.resources.fish > 0 && next.resources.water > 0) {
          next.resources = pay(next.resources, { fish: 1, water: 1 });
          events.push({ kind: "upkeep" });
        } else {
          events.push({ kind: "upkeep-missed" });
        }
        next.lastUpkeepAt += UPKEEP_MS;
      }
    }
  }
  if (now > limit) {
    for (const row of next.grid) {
      for (const cell of row) {
        if (cell) cell.accruedUntil = now;
      }
    }
    next.lastUpkeepAt = now;
  }
  next.updatedAt = now;
  const hungry = isHungry(next);
  return {
    ok: true,
    state: next,
    events,
    message: hungry ? "鱼或淡水断了，生产先停" : "",
  };
}

export function buildingTypes() {
  return BUILDABLE;
}
