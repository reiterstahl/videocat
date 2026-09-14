import assert from "node:assert/strict";
import test from "node:test";
import {
  companionTunnelHelloSchema,
  companionTunnelProtocolVersion,
  companionTunnelReconnectDelayMs,
  companionTunnelUrl
} from "@videocat/shared";

const companionId = "d2719ccd-2b98-4e4e-88e4-69f1b95fce53";

test("validates a bounded, paired control-tunnel handshake", () => {
  const parsed = companionTunnelHelloSchema.safeParse({
    type: "tunnel.hello",
    protocolVersion: companionTunnelProtocolVersion,
    companionId,
    credential: "vcat_agent_abcdefghijklmnopqrstuvwxyz123456",
    companionName: "Desktop VideoCAT",
    version: 14,
    capabilities: { control: true, streamRead: false }
  });

  assert.equal(parsed.success, true);
  assert.equal(companionTunnelHelloSchema.safeParse({
    type: "tunnel.hello",
    protocolVersion: companionTunnelProtocolVersion,
    companionId,
    credential: "too-short",
    version: 14,
    capabilities: { control: true, streamRead: true }
  }).success, false);
});

test("derives a websocket URL and caps reconnect backoff", () => {
  assert.equal(companionTunnelUrl("https://cat.example.com/"), "wss://cat.example.com/api/agent/tunnel");
  assert.equal(companionTunnelUrl("http://127.0.0.1:8081"), "ws://127.0.0.1:8081/api/agent/tunnel");
  assert.equal(companionTunnelReconnectDelayMs(1, () => 0), 1_000);
  assert.equal(companionTunnelReconnectDelayMs(99, () => 0.99), 60_000);
});
