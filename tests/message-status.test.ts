import assert from "node:assert/strict";
import { test } from "node:test";
import { getMessageStatus } from "../decky-plugin/src/messages/message-status.ts";

test("outgoing message acknowledgements map to the expected visible status", () => {
  assert.equal(getMessageStatus(1).label, "Sent");
  assert.equal(getMessageStatus(2).label, "Delivered");
  assert.equal(getMessageStatus(3).label, "Read");
  assert.equal(getMessageStatus(0).label, "Sending");
  assert.equal(getMessageStatus(-1).label, "Failed");
  assert.equal(getMessageStatus(undefined, true).label, "Delivery uncertain");
  assert.deepEqual(getMessageStatus(3), { symbol: "✓✓", color: "#63b9ff", label: "Read" });
  assert.deepEqual(getMessageStatus(-1), { symbol: "!", color: "#ff8d8d", label: "Failed" });
});
