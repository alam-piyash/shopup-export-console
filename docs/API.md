# ShopUp Export Console API

Base path: `/api`. Every route except `/api/health` needs `Authorization: Bearer <Supabase access token>`.

The API runs each request as the signed-in user inside one Postgres transaction
(`role = authenticated`, `request.jwt.claims` = the token's claims). Reads therefore return
only what the RLS policies allow, and every write is one call to a security-definer business
function that checks the role and applies the rule.

## Conventions

- JSON in, JSON out. Rows keep the database column names (snake_case).
- Write bodies use the function's argument names without the `p_` prefix.
  Unknown fields are refused with `400 unknown field: <name>`.
- Writes return the function's result: a new id as a JSON string, a JSON object, or `null`.
- Errors: `{"message", "code", "details", "hint"}`. Business rule messages come straight from the
  database and are meant to be shown to the user.

| Status | When |
| --- | --- |
| 400 | Business rule refused (`P0001`), bad input, bad id |
| 401 | Missing, invalid or expired token |
| 403 | Insufficient privilege (`42501`) |
| 404 | Unknown route or record |
| 409 | Duplicate (`23505`) |
| 500 | Unexpected error (logged, generic message returned) |

## Reads

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/health` | `{"status":"ok"}` when the database answers (no auth) |
| GET | `/me` | Signed-in user: id, email, full_name, avatar_url, role |
| GET | `/pending-counts` | Items waiting for approval (trades, collections, incentives, exp_amounts) |
| GET | `/demo-count` | Number of demo records |
| GET | `/profiles` | id, full_name, email of every user |
| GET | `/activity?limit=12&trade_id=` | Activity log, newest first (limit up to 500) |
| GET | `/access` | `{profiles, roles, preassignments}` for Access control |
| GET | `/company-profiles` | Exporter profiles, by label |
| GET | `/buyers` | Buyers, by name |
| GET | `/products` | Products, by description |
| GET | `/trades?status=active,revision_pending` | trade_overview rows, newest first |
| GET | `/trades/{id}` | `{trade, exps}` |
| GET | `/trades/{id}/items` | Item lines |
| GET | `/trades/{id}/amendments` | Amendments, newest number first |
| GET | `/trades/{id}/followups` | Follow-up checkpoints done |
| GET | `/trades/{id}/contract-documents?source=uploaded` | Sales contract versions, newest first |
| GET | `/trades/{id}/prepaids` | Prepaid and settlement collections of the trade |
| GET | `/exps?trade_id=&outstanding=true&incentive_eligible=true&order=asc` | exp_overview rows |
| GET | `/exps/{id}` | `{exp, docs, trade, versions}` |
| GET | `/exps/{id}/amount-changes` | Amount change requests, newest first |
| GET | `/exps/{id}/ci-sources` | `{trade, items, tt_files}` for the Commercial Invoice generator |
| GET | `/collections` | Collections with `trades` and `collection_exps` |
| GET | `/collections/{id}` | One collection row |
| GET | `/incentives` | Incentives with `incentive_exps` |
| GET | `/attachments?entity_id=a,b` | Files attached to records |
| GET | `/documents?entity_type=collection&entity_id=a,b` | Document slots with `document_versions` |

## Writes

| Method | Path | Database function | Body |
| --- | --- | --- | --- |
| POST | `/trades` | create_trade | data, items, file |
| POST | `/trades/{id}/approve` | approve_trade | |
| POST | `/trades/{id}/reject` | reject_trade | reason |
| POST | `/trades/{id}/close` | close_trade | |
| POST | `/trades/{id}/amendments` | request_amendment | data, items, file, changes |
| POST | `/amendments/{id}/approve` | approve_amendment | |
| POST | `/amendments/{id}/reject` | reject_amendment | reason |
| POST | `/amendments/{id}/withdraw` | withdraw_amendment | |
| POST | `/trades/{id}/contract-versions` | add_contract_version | file, source, note, stage, submitted_on |
| POST | `/contract-documents/{id}/sign` | mark_contract_signed | |
| POST | `/trades/{id}/followups/{checkpoint}/done` | mark_followup_done | note |
| POST | `/exps` | create_exp | trade, amount, advance, fields |
| PATCH | `/exps/{id}` | update_exp | amount, fields |
| POST | `/exps/bulk` | bulk_exps | mode, rows, commit |
| POST | `/exps/{id}/amount-changes` | request_exp_amount_change | amount, amount_usd, reason, file |
| POST | `/amount-changes/{id}/decide` | decide_exp_amount_change | approve, reason |
| POST | `/amount-changes/{id}/withdraw` | withdraw_exp_amount_change | |
| POST | `/exp-documents/{id}/versions` | upload_exp_document | file, stage, note, submitted_on |
| POST | `/exp-documents/{id}/finalize` | finalize_exp_document | |
| POST | `/documents/{id}/versions` | add_document_version | file, stage, note, submitted_on |
| POST | `/documents/{id}/finalize` | finalize_document | |
| POST | `/collections` | submit_collection | trade, amount, bank_ref, prepaid, lines, docs |
| POST | `/collections/{id}/settle` | settle_prepaid | lines |
| POST | `/collections/{id}/decide` | decide_collection | approve, reason |
| POST | `/incentives` | create_incentive | exp_ids, net, freight, pct, docs |
| POST | `/incentives/{id}/decide` | decide_incentive | approve, reason |
| POST | `/buyers` | save_buyer | the buyer object |
| POST | `/company-profiles` | save_company_profile | the profile object |
| POST | `/products` | save_product | the product object |
| POST | `/access/preassignments` | preassign_role | email, name, role |
| DELETE | `/access/preassignments/{email}` | delete_preassignment | |
| PUT | `/access/users/{id}/role` | set_user_role | role |
| DELETE | `/access/users/{id}` | remove_access | |
| DELETE | `/demo-data` | remove_demo_data | |

`file` objects are `{"path", "name", "size"}` as returned by the upload flow below.

## Files

Files never pass through the API. The API hands out short-lived Supabase Storage links,
created with the user's own token so the bucket policies still apply.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/files/upload-url` | folder, name, size (max 25 MB) | `{path, upload_url}`: PUT the file bytes to `upload_url` |
| POST | `/files/signed-url` | path, download (optional file name) | `{url}` valid for 2 minutes |
