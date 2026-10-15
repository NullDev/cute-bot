import { test } from "node:test";
import assert from "node:assert/strict";
import { welcomeText } from "../src/service/clan/welcome.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

test("welcomeText mentions the user, the IGN and both channels", () => {
    const text = welcomeText("123", "Shadow");
    assert.equal(text, "Welcome to `[cute]`, <@123> / `Shadow`! :3\nPlease check out <#1558968094251286548> and the latest infos in <#1104405759460114553>.\nStay cute and have fun~");
});
