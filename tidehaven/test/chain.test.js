import assert from "node:assert/strict";
import test from "node:test";
import {
  checkpointMessage,
  collectionParam,
  contractIdFromMint,
  ftMintParam,
  islandNftParam,
  settlePlan,
  snapshot,
} from "../src/chain.js";
import { CENTER, build, createGame } from "../src/rules.js";

test("mint, collection, and island payloads match the Turing Wallet calls", () => {
  const mint = ftMintParam("plank");
  assert.equal(mint.flag, "FT_MINT");
  assert.deepEqual(JSON.parse(mint.ft_data), {
    name: "潮屿木板",
    symbol: "PLANK",
    decimal: 0,
    amount: 1_000_000,
  });

  const collection = collectionParam();
  const collectionData = JSON.parse(collection.collection_data);
  assert.equal(collectionData.collectionName, "潮屿浮岛");
  assert.equal(collectionData.supply, 20);
  assert.match(collectionData.file, /^data:image\/png;base64,/);

  const state = build(createGame(1_000), CENTER, CENTER - 1, "collector", 1_000).state;
  const nft = islandNftParam("collection-txid", state);
  assert.equal(nft.collection_id, "collection-txid");
  const nftData = JSON.parse(nft.nft_data);
  assert.deepEqual(JSON.parse(nftData.attributes), snapshot(state));
  assert.equal(contractIdFromMint("contract-txid,mint-txid"), "contract-txid");
});

test("a build settles only the chain resources it actually spent", () => {
  const state = build(createGame(0), CENTER, CENTER - 1, "collector", 0);
  const missing = settlePlan({}, "1SinkAddressExample000000000000", state.cost);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing-contract");

  const plan = settlePlan(
    { plank: "plank-txid", rope: "rope-txid", metal: "metal-txid", plastic: "plastic-txid" },
    "1SinkAddressExample000000000000",
    state.cost,
  );
  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.params.map((param) => [param.flag, param.ft_contract_address, param.ft_amount]),
    [
      ["FT_TRANSFER", "plank-txid", 6],
      ["FT_TRANSFER", "rope-txid", 2],
    ],
  );
});

test("checkpoint text stays stable for the same island", () => {
  const state = createGame(50);
  assert.equal(checkpointMessage(state), checkpointMessage(structuredClone(state)));
  const parsed = JSON.parse(checkpointMessage(state));
  assert.equal(parsed.app, "tidehaven");
  assert.equal(parsed.state.cells.length, 1);
  assert.equal(parsed.state.cells[0].type, "raft");
});
