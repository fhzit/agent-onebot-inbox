# Provider qualification: checklist and result records

The static checklist and the provider/version results are separate. Neither is, by itself, proof that a provider works in production.

## Static checklist

`src/provider-qualification.ts` defines supported providers (`napcat`, `snowluma`) and transport, inbound, and outbound checks. Every checklist value remains `unverified`; it describes what to examine, not completed tests. `isProviderCapabilityQualified()` consults only that static checklist and never grants qualification from a result record.

## Version-specific result records

The admin API exposes the checklist at `GET /api/admin/provider-qualification/checklist`, reads an exact provider/version at `GET /api/admin/provider-qualification/:provider/:version`, and accepts operator-entered results at `PUT /api/admin/provider-qualification` with `{provider,version,checks:[{id,status,evidence?}]}`. All routes require the configured bearer API token.

Results are validated against the static provider/check IDs and keyed by normalized provider plus exact version. Pass/fail requires evidence; evidence is bounded text and must not contain secrets or unredacted user data. Replacing a provider/version record overwrites its previous checks; this is not append-only audit history. `providerTested` identifies an operator-entered result, not an automatically run or independently validated test.

When PostgreSQL is configured, the result store uses migration `0012_provider_qualification.sql`; without PostgreSQL, results are process-local and disappear on restart. Preserve source logs/artifacts separately: the record stores only a text description, not an evidence archive or signature.

## Operational limits

Record only observations for the exact provider version and environment. Leave untested checks `unverified`; do not infer results for another version. Review failed and unverified checks before relying on a result. The application does not currently gate runtime capabilities on these records: `isProviderCapabilityQualified()` remains fail-closed against the static checklist. A record is not a blanket production-readiness guarantee and does not replace real-provider testing or operator review.
