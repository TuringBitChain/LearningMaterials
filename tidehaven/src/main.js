import {
  BUILDINGS,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  buildingTypes,
  build,
  canAfford,
  cooldownLeft,
  createGame,
  crewCount,
  isHungry,
  salvage,
  tick,
} from "./rules.js";
import {
  CHAIN_RESOURCE_KEYS,
  checkpointMessage,
  collectionParam,
  contractIdFromMint,
  formatCost,
  formatGain,
  ftMintParam,
  islandNftParam,
  settlePlan,
} from "./chain.js";

const STORAGE_KEY = "tidehaven.v1";
const SHORTCUT = {
  collector: "收集器",
  fishery: "切鱼台",
  farm: "浮田",
  still: "海水提取",
  workshop: "工作台",
  boat: "拾荒船",
};

const gridEl = document.querySelector("#grid");
const resourcesEl = document.querySelector("#resources");
const statusEl = document.querySelector("#status");
const paletteEl = document.querySelector("#palette");
const hintEl = document.querySelector("#hint");
const logEl = document.querySelector("#log");
const addressEl = document.querySelector("#address");
const contractsEl = document.querySelector("#contracts");
const salvageButton = document.querySelector("#salvage");
const sinkInput = document.querySelector("#sink");
const syncInput = document.querySelector("#sync");

let selected = null;
let offset = 0;
let busy = false;
const saved = load();
let game = saved?.game ?? createGame(Date.now());
let chain = saved?.chain ?? {
  address: "",
  sink: "",
  sync: false,
  contracts: { plank: "", metal: "", plastic: "", rope: "" },
  collectionId: "",
  nftIds: [],
  checkpoints: [],
};

sinkInput.value = chain.sink;
syncInput.checked = chain.sync;

function now() {
  return Date.now() + offset;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ game, chain }));
}

function clockLabel(at) {
  return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
}

function log(message) {
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = clockLabel(Date.now());
  time.dateTime = new Date().toISOString();
  item.append(time, document.createTextNode(message));
  logEl.prepend(item);
  while (logEl.children.length > 14) logEl.lastElementChild.remove();
}

function shorten(value) {
  if (!value) return "还没有";
  if (value.startsWith("rehearse-")) return `${value}（演练）`;
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function wallet() {
  return globalThis.Turing ?? null;
}

function asList(value) {
  return Array.isArray(value) ? value : [value];
}

async function sendMany(params) {
  const injected = wallet();
  if (!injected?.sendTransaction) {
    return params.map((param, index) => ({
      rehearsed: true,
      txid: `rehearse-${index}-${Date.now().toString(36)}`,
      param,
    }));
  }
  if (injected.sendBatchRequest && params.length > 1) {
    const results = asList(
      await injected.sendBatchRequest(params.map((param) => ({ method: "sendTransaction", params: param }))),
    );
    return results.map((result) => {
      if (result?.error) throw new Error(result.error);
      return { rehearsed: false, txid: result?.txid ?? "" };
    });
  }
  const sent = [];
  for (const param of params) {
    const result = await injected.sendTransaction([param]);
    if (result?.error) throw new Error(result.error);
    sent.push({ rehearsed: false, txid: result?.txid ?? "" });
  }
  return sent;
}

async function signText(message) {
  const injected = wallet();
  if (!injected?.signMessage) {
    return { rehearsed: true, message, address: chain.address || "local", sig: "" };
  }
  const signed = await injected.signMessage({ message, encoding: "utf-8" });
  return { rehearsed: false, ...signed, message };
}

function renderResources() {
  resourcesEl.replaceChildren();
  for (const key of RESOURCE_KEYS) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const amount = document.createElement("b");
    name.textContent = RESOURCE_LABELS[key];
    amount.textContent = String(game.resources[key] ?? 0);
    item.append(name, amount);
    resourcesEl.append(item);
  }
}

function renderStatus() {
  const wait = cooldownLeft(game, now());
  const crew = crewCount(game);
  const hungry = isHungry(game);
  statusEl.className = hungry ? "hungry" : "ok";
  const food = hungry ? "鱼或淡水断了，生产先停" : "岛民吃得上";
  const sail = wait > 0 ? `拾荒还要 ${(wait / 1000).toFixed(0)} 秒` : "可以出海";
  statusEl.textContent = `${food} · ${crew} 处营生 · ${sail}`;
  salvageButton.disabled = wait > 0 || busy;
}

function cellIsReady(x, y) {
  if (!selected || game.grid[y][x]) return false;
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  return neighbors.some(([nx, ny]) => game.grid[ny]?.[nx]);
}

function renderGrid() {
  gridEl.replaceChildren();
  for (let y = 0; y < game.grid.length; y += 1) {
    for (let x = 0; x < game.grid[y].length; x += 1) {
      const cell = game.grid[y][x];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.x = String(x);
      button.dataset.y = String(y);
      button.setAttribute("role", "gridcell");
      if (!cell) {
        button.classList.add(cellIsReady(x, y) ? "ready" : "water");
        button.innerHTML = "<span>海面</span>";
      } else {
        button.classList.add("built", cell.type === "raft" ? "raft" : "station");
        const spec = BUILDINGS[cell.type];
        const title = document.createElement("strong");
        const note = document.createElement("span");
        title.textContent = spec.name;
        note.textContent = cell.type === "raft" ? "起点" : "运作中";
        button.append(title, note);
      }
      button.addEventListener("click", () => onCell(x, y));
      gridEl.append(button);
    }
  }
}

function renderPalette() {
  paletteEl.replaceChildren();
  for (const type of buildingTypes()) {
    const spec = BUILDINGS[type];
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.type = type;
    const name = document.createElement("b");
    const cost = document.createElement("small");
    name.textContent = SHORTCUT[type] ?? spec.name;
    cost.textContent = formatCost(spec.cost);
    button.append(name, cost);
    button.addEventListener("click", () => {
      selected = selected === type ? null : type;
      hintEl.textContent = selected
        ? `${spec.name}：${spec.blurb} 花费 ${formatCost(spec.cost)}。`
        : "先点一种建筑，再点挨着木筏的空海面。";
      paintPalette();
      renderGrid();
    });
    paletteEl.append(button);
  }
}

function paintPalette() {
  for (const button of paletteEl.querySelectorAll("button")) {
    const type = button.dataset.type;
    button.classList.toggle("on", type === selected);
    button.disabled = busy || !canAfford(game.resources, BUILDINGS[type].cost);
  }
}

function renderContracts() {
  const rows = [
    ["木板", chain.contracts.plank],
    ["金属", chain.contracts.metal],
    ["塑料", chain.contracts.plastic],
    ["绳索", chain.contracts.rope],
    ["合集", chain.collectionId],
    ["浮岛", chain.nftIds.at(-1) ?? ""],
    ["签名", chain.checkpoints.length ? `${chain.checkpoints.length} 次` : ""],
  ];
  contractsEl.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = shorten(value);
    detail.title = value || "";
    contractsEl.append(term, detail);
  }
  addressEl.textContent = chain.address
    ? `已连接 ${chain.address}`
    : wallet()
      ? "检测到 Turing 钱包，点连接后再签名。"
      : "未连接。没有钱包也能先在本地把岛建起来；链上按钮会进入演练，不广播。";
}

function render() {
  const stepped = tick(game, now());
  game = stepped.state;
  renderResources();
  renderStatus();
  renderGrid();
  paintPalette();
  persist();
}

async function onCell(x, y) {
  if (busy) return;
  if (!selected) {
    const cell = game.grid[y][x];
    if (cell) log(`${BUILDINGS[cell.type].name}还在原处`);
    return;
  }
  const before = game;
  const placed = build(game, x, y, selected, now());
  if (!placed.ok) {
    log(placed.message);
    return;
  }
  if (syncInput.checked) {
    const plan = settlePlan(chain.contracts, sinkInput.value.trim(), placed.cost);
    if (!plan.ok) {
      log(plan.reason === "missing-sink" ? "先填金库地址，这次只盖在本地" : "物资合约还没发行，这次只盖在本地");
    } else if (plan.params.length > 0) {
      busy = true;
      renderStatus();
      try {
        const results = await sendMany(plan.params);
        const ids = results.map((result) => result.txid).filter(Boolean);
        log(
          results.some((result) => result.rehearsed)
            ? `演练转出 ${formatCost(placed.cost)}，没有广播`
            : `花费已转到金库 ${ids.join(", ")}`,
        );
      } catch (error) {
        game = before;
        log(`链上转账没完成，建造取消：${error.message}`);
        busy = false;
        render();
        return;
      }
      busy = false;
    }
  }
  game = placed.state;
  log(`${placed.message}（${formatCost(placed.cost)}）`);
  render();
}

async function onSalvage() {
  const result = salvage(game, now(), Math.random);
  if (!result.ok) {
    log(result.message);
    renderStatus();
    return;
  }
  game = result.state;
  if (result.shark) {
    gridEl.classList.add("shark");
    setTimeout(() => gridEl.classList.remove("shark"), 450);
    log(result.message);
  } else {
    log(`${result.message}：${formatGain(result.gain)}`);
  }
  render();
}

function onForward() {
  offset += 20_000;
  const stepped = tick(game, now());
  game = stepped.state;
  const made = stepped.events.filter((event) => event.kind === "produce").length;
  const fed = stepped.events.filter((event) => event.kind === "upkeep").length;
  log(`快进 20 秒，生产 ${made} 次，开伙 ${fed} 次`);
  render();
}

async function onConnect() {
  const injected = wallet();
  if (!injected?.connect) {
    log("页面里没有 Turing 钱包。链上操作会先演练。");
    renderContracts();
    return;
  }
  try {
    const addresses = await injected.connect();
    chain.address = addresses?.tbcAddress ?? "";
    if (!chain.address) throw new Error("这个账户没有 TBC 地址");
    log(`连上 ${chain.address}`);
    persist();
    renderContracts();
  } catch (error) {
    log(`连接失败：${error.message}`);
  }
}

async function onMint() {
  if (busy) return;
  busy = true;
  try {
    const params = CHAIN_RESOURCE_KEYS.map((key) => ftMintParam(key));
    const results = await sendMany(params);
    CHAIN_RESOURCE_KEYS.forEach((key, index) => {
      chain.contracts[key] = contractIdFromMint(results[index]?.txid ?? "");
    });
    log(
      results.some((result) => result.rehearsed)
        ? "演练发行了木板、金属、塑料、绳索。装上钱包后会真正 FT_MINT。"
        : "四种物资已发行。合约号用的是每笔返回里的第一段 txid。",
    );
    persist();
    renderContracts();
  } catch (error) {
    log(`发行失败：${error.message}`);
  } finally {
    busy = false;
    renderStatus();
  }
}

async function onCollection() {
  if (busy) return;
  busy = true;
  try {
    const [result] = await sendMany([collectionParam()]);
    chain.collectionId = contractIdFromMint(result?.txid ?? "");
    log(result?.rehearsed ? "演练创建了浮岛合集，没有广播" : `浮岛合集 ${chain.collectionId}`);
    persist();
    renderContracts();
  } catch (error) {
    log(`合集创建失败：${error.message}`);
  } finally {
    busy = false;
    renderStatus();
  }
}

async function onIsland() {
  if (!chain.collectionId) {
    log("先创建浮岛合集");
    return;
  }
  if (busy) return;
  busy = true;
  try {
    const [result] = await sendMany([islandNftParam(chain.collectionId, game)]);
    const nftId = contractIdFromMint(result?.txid ?? "");
    if (nftId) chain.nftIds.push(nftId);
    log(result?.rehearsed ? "演练铸造了一枚浮岛快照" : `浮岛快照 ${nftId}`);
    persist();
    renderContracts();
  } catch (error) {
    log(`铸造失败：${error.message}`);
  } finally {
    busy = false;
    renderStatus();
  }
}

async function onSign() {
  try {
    const message = checkpointMessage(game);
    const signed = await signText(message);
    chain.checkpoints.push({
      at: Date.now(),
      address: signed.address ?? chain.address,
      sig: signed.sig ?? "",
      rehearsed: Boolean(signed.rehearsed),
    });
    log(signed.rehearsed ? "演练签署了存档。消息在本地存档里。" : "存档已由钱包签名");
    persist();
    renderContracts();
  } catch (error) {
    log(`签名失败：${error.message}`);
  }
}

function onReset() {
  if (!confirm("清掉这块浮岛的本地存档？链上已经广播的交易还在。")) return;
  game = createGame(Date.now());
  offset = 0;
  selected = null;
  chain = {
    address: chain.address,
    sink: sinkInput.value.trim(),
    sync: syncInput.checked,
    contracts: { plank: "", metal: "", plastic: "", rope: "" },
    collectionId: "",
    nftIds: [],
    checkpoints: [],
  };
  log("换了一块新木筏");
  render();
  renderContracts();
}

sinkInput.addEventListener("change", () => {
  chain.sink = sinkInput.value.trim();
  persist();
});
syncInput.addEventListener("change", () => {
  chain.sync = syncInput.checked;
  persist();
});
document.querySelector("#connect").addEventListener("click", onConnect);
document.querySelector("#salvage").addEventListener("click", onSalvage);
document.querySelector("#forward").addEventListener("click", onForward);
document.querySelector("#mint").addEventListener("click", onMint);
document.querySelector("#collection").addEventListener("click", onCollection);
document.querySelector("#island").addEventListener("click", onIsland);
document.querySelector("#sign").addEventListener("click", onSign);
document.querySelector("#reset").addEventListener("click", onReset);

renderPalette();
renderContracts();
const caughtUp = tick(game, now());
game = caughtUp.state;
if (caughtUp.events.length > 0) log("离线这段时间，岛上自己转了一阵");
render();
log("木筏还在。先盖收集器，或者直接出海。");
setInterval(render, 1000);
