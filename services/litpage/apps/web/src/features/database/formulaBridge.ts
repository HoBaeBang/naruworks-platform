// Plugs the formula language (packages/shared/src/formula/index.ts, owned by the formula/relation/rollup
// work stream) into the shared database engine when that module exists. import.meta.glob keeps this file
// compiling before the module is written: the glob simply matches nothing.
import { registerFormulaEngine, registerRollupEngine, type FormulaEvaluator, type RollupEvaluator } from '@nc/shared/database/computed.ts';

const mods = import.meta.glob('../../../../../packages/shared/src/formula/index.ts', { eager: true }) as Record<string, { evaluateFormula?: FormulaEvaluator; evaluateRollup?: RollupEvaluator }>;

for (const mod of Object.values(mods)) {
  if (typeof mod.evaluateFormula === 'function') registerFormulaEngine(mod.evaluateFormula);
  if (typeof mod.evaluateRollup === 'function') registerRollupEngine(mod.evaluateRollup);
}
