import assert from "node:assert/strict";
import { test } from "node:test";
import { getViewOnceNotice } from "./view-once";

test("view-once media gets a clear phone fallback without claiming it was viewed", () => {
  const notice = getViewOnceNotice(true);
  assert.match(notice || "", /can't be opened in Decky WhatsApp/i);
  assert.match(notice || "", /WhatsApp on your phone/i);
  assert.doesNotMatch(notice || "", /viewed|opened successfully/i);
});

test("ordinary messages have no view-once notice", () => {
  assert.equal(getViewOnceNotice(false), undefined);
  assert.equal(getViewOnceNotice(undefined), undefined);
});
