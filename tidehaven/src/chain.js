import { BUILDINGS, RESOURCE_KEYS, RESOURCE_LABELS } from "./rules.js";

export const APP = "tidehaven";
export const SNAPSHOT_VERSION = 1;

export const COLLECTION_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAhElEQVR42mPg8EoYVIhh1EGjDhp10KiDyEExVgoQNOogQg768uYafjQEHSSU10A5It5BBI0addCogyh20Gi2H8YO2lHmgAvBHYRHDfWrjkHqoGtLEjAR3EFYZQfAQfjRCHMQ2WjUQaMOGnXQqINGu9KjDhp10KiDRh006qBRB406aFAgAFOJKtFcZq1tAAAAAElFTkSuQmCC";

export const TOKENS = {
  plank: { name: "潮屿木板", symbol: "PLANK", decimal: 0, amount: 1_000_000 },
  metal: { name: "潮屿金属", symbol: "METAL", decimal: 0, amount: 1_000_000 },
  plastic: { name: "潮屿塑料", symbol: "PLAS", decimal: 0, amount: 1_000_000 },
  rope: { name: "潮屿绳索", symbol: "ROPE", decimal: 0, amount: 1_000_000 },
};

export const CHAIN_RESOURCE_KEYS = ["plank", "metal", "plastic", "rope"];

export function snapshot(state) {
  const cells = [];
  for (let y = 0; y < state.grid.length; y += 1) {
    for (let x = 0; x < state.grid[y].length; x += 1) {
      const cell = state.grid[y][x];
      if (!cell) continue;
      cells.push({ x, y, type: cell.type, level: cell.level });
    }
  }
  const res = {};
  for (const key of RESOURCE_KEYS) res[key] = state.resources[key] ?? 0;
  return { v: SNAPSHOT_VERSION, t: state.updatedAt, res, cells };
}

export function checkpointMessage(state) {
  return JSON.stringify({ app: APP, v: SNAPSHOT_VERSION, state: snapshot(state) });
}

export function describeSnapshot(state) {
  const shot = snapshot(state);
  const names = shot.cells.map((cell) => BUILDINGS[cell.type]?.name ?? cell.type);
  return names.join("、");
}

export function ftMintParam(key) {
  const token = TOKENS[key];
  if (!token) throw new Error(`unknown token ${key}`);
  return {
    flag: "FT_MINT",
    ft_data: JSON.stringify({
      name: token.name,
      symbol: token.symbol,
      decimal: token.decimal,
      amount: token.amount,
    }),
    broadcastEnabled: true,
  };
}

export function collectionParam() {
  return {
    flag: "COLLECTION_CREATE",
    collection_data: JSON.stringify({
      collectionName: "潮屿浮岛",
      description: "潮屿玩家的浮岛快照。每一枚 NFT 是当时的存档，不能改写。",
      supply: 20,
      file: COLLECTION_IMAGE,
    }),
    broadcastEnabled: true,
  };
}

export function islandNftParam(collectionId, state) {
  if (!collectionId) throw new Error("missing collection id");
  const shot = snapshot(state);
  return {
    flag: "NFT_CREATE",
    collection_id: collectionId,
    nft_data: JSON.stringify({
      nftName: `浮岛 #${shot.t}`,
      symbol: "ISLE",
      description: describeSnapshot(state),
      attributes: JSON.stringify(shot),
    }),
    broadcastEnabled: true,
  };
}

export function transferParam(contractId, address, amount) {
  if (!contractId) throw new Error("missing ft contract");
  if (!address) throw new Error("missing sink address");
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer");
  return {
    flag: "FT_TRANSFER",
    ft_contract_address: contractId,
    address,
    ft_amount: amount,
    broadcastEnabled: true,
  };
}

export function settlePlan(contracts, sink, cost) {
  const params = [];
  for (const key of CHAIN_RESOURCE_KEYS) {
    const amount = cost?.[key] ?? 0;
    if (amount <= 0) continue;
    const contractId = contracts?.[key];
    if (!contractId) {
      return { ok: false, reason: "missing-contract", key, params: [] };
    }
    params.push(transferParam(contractId, sink, amount));
  }
  if (!sink) return { ok: false, reason: "missing-sink", params: [] };
  if (params.length === 0) return { ok: true, params: [], reason: "nothing" };
  return { ok: true, params };
}

export function contractIdFromMint(txid) {
  if (!txid || typeof txid !== "string") return "";
  return txid.split(",")[0].trim();
}

export function formatGain(gain) {
  const parts = [];
  for (const key of RESOURCE_KEYS) {
    if (gain?.[key]) parts.push(`${RESOURCE_LABELS[key]}+${gain[key]}`);
  }
  return parts.join(" ");
}

export function formatCost(cost) {
  const parts = [];
  for (const key of RESOURCE_KEYS) {
    if (cost?.[key]) parts.push(`${RESOURCE_LABELS[key]}-${cost[key]}`);
  }
  return parts.join(" ");
}
