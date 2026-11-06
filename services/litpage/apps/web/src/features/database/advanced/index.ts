// Public API of the advanced database module (formulas, relations, rollups) for the database core:
//   openFormulaEditor(anchor, {collectionId, propertyId, rowId?})
//   openRelationConfig(anchor, {collectionId, propertyId?, view?, afterPropId?})
//   openRollupConfig(anchor, {collectionId, propertyId})
//   setRelationValue(rowId, propId, ids)  — two-way relation sync in one transaction
//   FormulaValueView — render a formula/rollup FValue
export { openFormulaEditor, saveFormula } from './FormulaEditor.tsx';
export { openRelationConfig } from './RelationConfig.tsx';
export { openRollupConfig, calculateMenu, aggregationLabel, NUMBER_FORMAT_LABEL, PRECISIONS } from './RollupConfig.tsx';
export { FormulaValueView, PageMention, PersonChip, RichRuns } from './FormulaValueView.tsx';
export {
  setRelationValue, addRelationTarget, removeRelationTarget, createRelationProperty, setRelationLimit, setRelationTwoWay, setRelationTarget, updateRollup, newPropId,
} from './relations.ts';
export { formulaContext, userTimeZone, startOfWeekSetting, rowsOfCollection, titleOf, collectionName } from './context.ts';
