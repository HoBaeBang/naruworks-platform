Endpoint modules. Each `*.ts` file exports `handlers: Record<string, (ctx, body) => any>`; names become
`POST /api/v3/<name>`. Use helpers from `../handlers.ts` (ApiError, Ctx) and `../../records.ts`
(RecordMapBuilder, applyTransactions, blockRole). Keep one file per feature area.
