import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount } from "../src/budgetcmd";
import { readConfig, run, sandbox } from "./helpers";

// Hand check: what people type, and the number it means (null = refused).
const AMOUNTS = [
  { typed: "200", amount: 200 },
  { typed: "$150", amount: 150 },
  { typed: "$ 1,200.50", amount: 1200.5 },
  { typed: "0", amount: null },
  { typed: "-5", amount: null },
  { typed: "abc", amount: null },
  { typed: "", amount: null },
] as const;

AMOUNTS.forEach((a) => {
  test(`parseAmount("${a.typed}") → ${a.amount}`, () => {
    assert.equal(parseAmount(a.typed), a.amount);
  });
});

const budgetOf = (box: ReturnType<typeof sandbox>): unknown => (readConfig(box).statusline as { budget?: { monthlyUsd: unknown } }).budget?.monthlyUsd;
const BUDGET = "budget";
const OFF = "off";
const AMOUNT = { plain: 200, formatted: 1200.5 } as const;
const HEADER_MAX = 12;

test("budget: set, read back, remove", () => {
  const box = sandbox();
  assert.ok(run(box, [BUDGET, "200"]).stdout.includes("$200 a month"));
  assert.equal(budgetOf(box), AMOUNT.plain);
  assert.ok(run(box, [BUDGET]).stdout.includes("$200 a month"));
  assert.ok(run(box, [BUDGET, OFF]).stdout.includes("no budget"));
  assert.equal(budgetOf(box), null);
});

test("budget: '$1,200.50' is accepted as 1200.5", () => {
  const box = sandbox();
  run(box, [BUDGET, "$1,200.50"]);
  assert.equal(budgetOf(box), AMOUNT.formatted);
});

test("budget: nonsense is refused and the old budget stays", () => {
  const box = sandbox();
  run(box, [BUDGET, "200"]);
  const r = run(box, [BUDGET, "abc"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("positive number"));
  assert.equal(budgetOf(box), AMOUNT.plain);
});

test("budget questions: one single-choice question, four options, each with a value", () => {
  const box = sandbox();
  const out = JSON.parse(run(box, [BUDGET, "questions"]).stdout);
  assert.equal(out.question.multiSelect, false);
  assert.equal(out.question.options.length, Object.keys(out.values).length);
  assert.equal(out.values["No budget"], OFF);
  assert.equal(out.values["$200 / month"], "200");
  assert.ok(out.question.header.length <= HEADER_MAX);
});

test("choosing fields afterwards keeps the budget", () => {
  const box = sandbox();
  run(box, [BUDGET, "200"]);
  run(box, ["fields", "set", "model"]);
  assert.equal(budgetOf(box), AMOUNT.plain);
});
