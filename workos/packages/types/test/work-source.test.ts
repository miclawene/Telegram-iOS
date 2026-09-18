import assert from "node:assert/strict";
import { test } from "node:test";

import {
  serializeSource,
  parseSource,
  sameSource,
  sourceKey,
  messageRefFromSource,
  sameMessageRef,
  resolveSourceState,
  type TelegramChannelSource,
} from "../src/index.js";

const A: TelegramChannelSource = { type: "telegram", accountId: "acc-A", peerId: "1000" };
const B: TelegramChannelSource = { type: "telegram", accountId: "acc-B", peerId: "1000" };

test("source serialization round-trips", () => {
  const raw = serializeSource(A);
  const parsed = parseSource(raw);
  assert.deepEqual(parsed, A);
});

test("parseSource rejects malformed / wrong-type input", () => {
  assert.equal(parseSource("not json"), null);
  assert.equal(parseSource(JSON.stringify({ type: "email", accountId: "x", peerId: "y" })), null);
  assert.equal(parseSource(JSON.stringify({ type: "telegram", accountId: "x" })), null);
});

test("multi-account: same peerId across accounts is NOT the same source (ТЗ §6, §56)", () => {
  assert.equal(A.peerId, B.peerId);
  assert.equal(sameSource(A, B), false);
  assert.notEqual(sourceKey(A), sourceKey(B));
});

test("sameSource is true only when account AND peer match", () => {
  assert.equal(sameSource(A, { ...A }), true);
  assert.equal(sameSource(A, { ...A, peerId: "1001" }), false);
});

test("message reference derives from source and compares by identity", () => {
  const ref = messageRefFromSource(A, "42");
  assert.deepEqual(ref, { accountId: "acc-A", peerId: "1000", messageId: "42" });
  assert.equal(sameMessageRef(ref, messageRefFromSource(A, "42")), true);
  assert.equal(sameMessageRef(ref, messageRefFromSource(B, "42")), false);
  assert.equal(sameMessageRef(ref, messageRefFromSource(A, "43")), false);
});

test("resolveSourceState maps outcomes to UI states (ТЗ §22)", () => {
  assert.equal(resolveSourceState({ hasSource: false }), "no_source");
  assert.equal(resolveSourceState({ hasSource: true, accountLoggedOut: true }), "account_logged_out");
  assert.equal(resolveSourceState({ hasSource: true, peerDeleted: true }), "peer_deleted");
  assert.equal(resolveSourceState({ hasSource: true, accessDenied: true }), "access_denied");
  assert.equal(resolveSourceState({ hasSource: true, peerFound: true }), "available");
  assert.equal(resolveSourceState({ hasSource: true }), "peer_unavailable");
});
