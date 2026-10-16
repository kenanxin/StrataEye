# Task 2 formal run and evidence-bound report

Status: formal invocation succeeded once; four named QA documents committed and self-reviewed. Commit 797caeaea26131eab75adc69601f3a30dca1b99f, direct parent 085dfa9de1b6f126396289dd76c55be937f1c547. Independent Task 2 reviewer and whole-phase final technical review remain pending. Human scientific and literature review pending; submission_ready=false.

## Instructions, freeze, and read-only preflight

Read task-2-brief.md and task-2-constraints.md first, completely. The complete Global Constraints were followed; the full controller plan was not read or edited. Read Task 1 execution evidence, scientific-writing/SKILL.md completely, and its evidence_workflow.md, writing_principles.md, figures_tables.md references before drafting. Root's supplied Task 1 gate was Spec compliant / Quality Approved with no findings; preflight HEAD was 085dfa9de1b6f126396289dd76c55be937f1c547. Root had independently verified 26 original source bytes, teacher hash and source Git provenance before dispatch.

Read-only preflight commands included:

```powershell
git -c maintenance.auto=false -c gc.auto=0 status --short
git rev-parse HEAD
Test-Path -LiteralPath 'D:/矿业/outputs/roof-mechanics-fresh-cohort/2026-10-13'
git -c maintenance.auto=false -c gc.auto=0 diff --stat
```

Observed HEAD 085dfa9de1b6f126396289dd76c55be937f1c547; formal output False (absent); tracked diff empty. Eleven pre-existing untracked files listed below were preserved. Some read-only exploration failed: Get-Content tools/roof_mechanics/bounded_error_study.py targeted a nonexistent filename; rg tools/roof_mechanics/*study*.py failed because PowerShell passed the wildcard literally; a later rg also named absent evaluate.py. Each was resolved by reading the observed uncertainty_study.py, limits_sensitivity.py, known_limits.py, dataset.py and train.py interfaces. No state change occurred.

## Exactly one formal invocation

CWD: D:/矿业/worktrees/teacher-feedback-v1. Python: D:/矿业/smart-mine-v2-balanced/.venv-data/Scripts/python.exe with -B. Literal actual PowerShell wrapper:

```powershell
$formalStartUtc = [DateTime]::UtcNow.ToString('o'); Write-Output ('formal_start_utc=' + $formalStartUtc); & 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.fresh_cohort_study --output-dir 'D:\矿业\outputs\roof-mechanics-fresh-cohort\2026-10-13'; $formalExitCode = $LASTEXITCODE; $formalEndUtc = [DateTime]::UtcNow.ToString('o'); Write-Output ('formal_exit_code=' + $formalExitCode); Write-Output ('formal_end_utc=' + $formalEndUtc); exit $formalExitCode
```

Actual formal command inside wrapper (no extra explicit flags; approved defaults preserved):

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.fresh_cohort_study --output-dir 'D:\矿业\outputs\roof-mechanics-fresh-cohort\2026-10-13'
```

Actual output lines:

```text
formal_start_utc=2026-10-13T15:54:00.9725838Z
Generating fresh-replicate-a: 100+100 scenarios
Generating fresh-replicate-b: 100+100 scenarios
Scoring fresh-replicate-a/fresh_in_domain: 2527 eligible rows, 27 conditions
Scoring fresh-replicate-a/fresh_ood: 2518 eligible rows, 27 conditions
Scoring fresh-replicate-b/fresh_in_domain: 2505 eligible rows, 27 conditions
Scoring fresh-replicate-b/fresh_ood: 2565 eligible rows, 27 conditions
Auditing fresh datasets and all frozen-model predictions
formal_exit_code=0
formal_end_utc=2026-10-13T15:59:31.3286592Z
```

Terminal final JSON also reported output_dir, readback with manifest, original selections and source_manifest_sha256. Chinese paths in terminal stdout had console-encoding replacement characters; archived UTF-8 files remained correct. Protocol timestamp was read as raw JSON and preserved literally: 2026-10-13T15:54:21.750344+00:00; no PowerShell date parse/roundtrip was used. Lightweight export initially used ensure_ascii=False and demonstrated the same display issue; it was repeated with ensure_ascii=True to carry metadata safely. This repeated only hashes/reads, never generation or inference.

Actual readback and final manifest summary:

```json
{
  "passed": true,
  "cells_checked": 324,
  "summaries_checked": 108,
  "predictions_checked": 108,
  "csv_rows_checked": 324,
  "datasets_checked": 2,
  "regenerated_scenarios": 400,
  "reconstructed_raw_rows": 10515,
  "eligible_rows_checked": 10115,
  "deterministic_replay": true,
  "replay_is_independent_source": false,
  "disjointness_checked": true,
  "source_readback_passed": true,
  "source_manifest_unchanged": true,
  "saved_models_unchanged": true,
  "teacher_csv_unchanged": true,
  "independent_denominator_reconstruction": true,
  "analysis_code_provenance": "pre_generation_code_hashes_verified",
  "manifest": {
    "passed": true,
    "checked_files": 9,
    "manifest_sha256": "4af915e447446e5d1fd0a52cd1effa14631820c9f1b0cdec8483d97accc325e8"
  }
}
```

Elapsed outer UTC interval is recorded by its endpoints; no extra score/training invocation, reseeding or overwrite was made. The runner's original-source readback and single complete new-cohort audit are integral to the one formal call. Formal archive at D:/矿业/outputs/roof-mechanics-fresh-cohort/2026-10-13 is retained intact.

## Byte-only/structure post-check (no inference)

Literal successful command, exit 0:

```powershell
$qaAuditCode = @'
import csv, hashlib, json
from pathlib import Path
root=Path.cwd()
out=Path("D:/矿业/outputs/roof-mechanics-fresh-cohort/2026-10-13")
load=lambda p:json.loads(p.read_text(encoding="utf-8"))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=load(out/"protocol.json"); m=load(out/"manifest.json")
assert set(x.relative_to(out).as_posix() for x in out.rglob("*") if x.is_file())==set(p["expected_files"])
for name,entry in m["files"].items():
    assert sha(out/name)==entry["sha256"] and (out/name).stat().st_size==entry["bytes"]
after={name:sha(root/name) for name in p["analysis_code_sha256"]}
assert after==p["analysis_code_sha256"]
source=Path(p["source_dir"])
for name,entry in p["source_file_hashes"].items():
    assert sha(source/name)==entry["sha256"] and (source/name).stat().st_size==entry["bytes"]
assert sha(source/"manifest.json")==p["source_manifest_sha256"]
assert sha(Path(p["teacher_csv"]["path"]))==p["teacher_csv"]["sha256"]
datasets={}
for c in p["cohorts"]:
    d=load(out/"cohorts"/c["name"]/"dataset.json")
    datasets[c["name"]]={"metadata":d["metadata"],"verification":d["verification"],"raw_rows":len(d["rows"]),"eligible_rows":sum(r["step"]>=1 for r in d["rows"]),"scenario_count":len(d["scenarios"])}
results=load(out/"results.json"); pred=load(out/"predictions.json")
rows=list(csv.DictReader((out/"comparison.csv").open(encoding="utf-8",newline="")))
assert len(results["cells"])==324 and len(results["summaries"])==108 and len(pred)==108 and len(rows)==324
dis=load(out/"disjointness.json"); dis.pop("groups")
print(json.dumps({"passed":True,"formal_file_count":10,"manifest_covered_files":9,"manifest_sha256":sha(out/"manifest.json"),"manifest":m,"readback":load(out/"readback.json"),"source_check":load(out/"source-check.json"),"analysis_code_sha256_after":after,"datasets":datasets,"disjointness":dis,"cells":len(results["cells"]),"summaries":len(results["summaries"]),"prediction_records":len(pred),"csv_rows":len(rows),"old_uncertainty_comparison_sha256":sha(Path("D:/矿业/outputs/roof-mechanics-uncertainty/2026-10-13/comparison.csv"))},ensure_ascii=True,allow_nan=False))
'@
& 'D:/矿业/smart-mine-v2-balanced/.venv-data/Scripts/python.exe' -B -c $qaAuditCode
```

Passed exact total-file coverage and every formal manifest hash/byte count (9 members, 10 total), all 26 original source-member hashes/byte counts, source manifest hash, teacher bytes, 14 current code/test/helper hashes, JSON record counts and CSV rows. Dataset metadata and disjointness totals were read, not regenerated. Complete original/formal manifests, model/teacher before/after and before/after code hashes are embedded in the QA evidence JSON.

Important verified hashes:
- Source manifest before=after: 031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537
- Formal manifest: 4af915e447446e5d1fd0a52cd1effa14631820c9f1b0cdec8483d97accc325e8
- Formal comparison.csv: d6b78133c671944e6b0ea9b126ceafc0b4c3ca5f32b61542094dee54ef715399
- Teacher before=after: 86d4c2fb192721b2745f00076aeb00cf351c654ed936ddb098bfa6217e30ac6a
- Model A before=after: 29d2c3a7f23a90740367b889282f1c7de2b80bee8ae52777954e784d54fd507f
- Model B before=after: 196bd0cdfb9b4e4173051340931cacace13eb1a3e3bd7a0d01c0303edea6132d

Software source/analysis versions match: Python3.10.10, NumPy1.26.4, sklearn1.7.2, XGBoost3.2.0, joblib1.6.0, Windows-10-10.0.26200-SP0.

## QA files and scope

Only these four final QA paths are owned and committed:

- docs/qa/2026-10-13-roof-mechanics-fresh-cohort-results.md
- docs/qa/2026-10-13-roof-mechanics-fresh-cohort-evidence.json
- docs/qa/2026-10-13-roof-mechanics-fresh-cohort-tests.md
- docs/qa/2026-10-13-roof-mechanics-fresh-cohort-review.md

This detailed execution report is the only additional task-owned scratch document; controller will preserve/archive it after review. No code/test/README, ledger/spec/plan, old experiment, teacher data or old QA document changed.

Results include:
- All eight exact/strength+20 group tables for C/U/P, Macro-F1, class3 and low-class denominators.
- Review row/scenario, marked/unmarked underestimate, upper capture, range/set coverage denominators.
- Event alert2 and alert3 timely and non-limit alert counts with separate populations.
- Four independent adverse maxima across all eight joint conditions with complete ties, plus all 32 group/joint adverse rows.
- Descriptive old test/ood vs new fresh_in_domain/fresh_ood ratios with different populations named; no pooling, significance, causal improvement or field reliability claim.
- Every formal file linked, all324 CSV rows accessible;115 physical-line claims bound to14 evidence IDs with hashes and human verification pending.
- Workflow-only Kassis et al2026 citation; root actually opened current arXiv record on2026-10-13 and checked authors/year/DOI/no journal reference. Human scientific/literature verification remains pending. No web/cloud action was performed by Task2.

## Claim-binding and document consistency commands

Literal claim-binding command, exit 0,115 unique claims:

```powershell
$qaClaimCode = @'
import hashlib,json,re
from pathlib import Path
root=Path.cwd(); stem="2026-10-13-roof-mechanics-fresh-cohort"
claims=[]
for suffix in ("results","tests","review"):
    path=root/"docs"/"qa"/(stem+"-"+suffix+".md")
    for number,line in enumerate(path.read_text(encoding="utf-8").splitlines(),1):
        ids=re.findall(r"\[claim:(C\d+)\]",line)
        if not ids: continue
        assert len(ids)==1
        evidence=re.search(r"\[evidence:([^\]]+)\]",line).group(1).split(",")
        normalized=" ".join(re.sub(r"\[(?:claim:[^\]]+|evidence:[^\]]+)\]","",line).split())
        claims.append({"claim_id":ids[0],"document":path.relative_to(root).as_posix(),"line":number,"claim_text_sha256":hashlib.sha256(normalized.encode("utf-8")).hexdigest(),"evidence_ids":evidence,"human_verification":"pending"})
assert len(claims)==len({x["claim_id"] for x in claims})==115
inputs={}
for name in ("task-1-report.md","task-2-brief.md","task-2-constraints.md"):
    path=root/".superpowers"/"sdd"/"2026-10-13-roof-mechanics-fresh-cohort"/name
    inputs[name]={"path":str(path),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}
print(json.dumps({"claims":claims,"input_records":inputs},ensure_ascii=True))
'@
& 'D:/矿业/smart-mine-v2-balanced/.venv-data/Scripts/python.exe' -B -c $qaClaimCode
```

Literal validation command, exit 0:

```powershell
$qaValidateCode = @'
import csv, hashlib, json, re
from pathlib import Path
root=Path.cwd(); stem="2026-10-13-roof-mechanics-fresh-cohort"; qa=root/"docs"/"qa"
ev=json.loads((qa/(stem+"-evidence.json")).read_text(encoding="utf-8"))
assert ev["formal_invocation_count"]==1 and ev["execution"]["exit_code"]==0
assert ev["technical_status"]["final_whole_delta_review"]=="pending"
assert ev["human_scientific_approval"]=="pending" and not ev["submission_ready"] and ev["no_live_integration"]
ids={s["evidence_id"] for s in ev["source_manifest_registry"]}
for c in ev["claims_registry"]:
    line=(root/c["document"]).read_text(encoding="utf-8").splitlines()[c["line"]-1]
    normalized=" ".join(re.sub(r"\[(?:claim:[^\]]+|evidence:[^\]]+)\]","",line).split())
    assert hashlib.sha256(normalized.encode("utf-8")).hexdigest()==c["claim_text_sha256"]
    assert all(i in ids for i in c["evidence_ids"])
out=Path(ev["execution"]["formal_archive"])
p=json.loads((out/"protocol.json").read_text(encoding="utf-8"))
assert p==ev["protocol"] and p["created_utc"]==ev["execution"]["protocol_created_utc_raw"]
assert p["source_file_hashes"]==ev["source_manifest"]["files"]
assert p["analysis_code_sha256"]==ev["analysis_code_sha256_before"]==ev["analysis_code_sha256_after"]
assert json.loads((out/"readback.json").read_text(encoding="utf-8"))==ev["audit_totals"]
rows=list(csv.DictReader((out/"comparison.csv").open(encoding="utf-8",newline="")))
assert len(rows)==324
groups=[("fresh-replicate-a","fresh_in_domain"),("fresh-replicate-a","fresh_ood"),("fresh-replicate-b","fresh_in_domain"),("fresh-replicate-b","fresh_ood")]
candidates=["center","sampled_upper","estimated_current_limit"]
find=lambda rep,split,case,candidate:next(r for r in rows if (r["replicate"],r["split"],r["case_id"],r["candidate"])==(rep,split,case,candidate))
label=lambda rep,split:rep[-1].upper()+(" 新域内" if split=="fresh_in_domain" else " 新OOD")
case_label=lambda case:"exact" if case=="exact" else "强度 +20%"
expected=[]
for case in ("exact","bending_strength_mpa_plus20"):
    for rep,split in groups:
        rr=[find(rep,split,case,c) for c in candidates]; r=rr[0]
        expected.append([case_label(case),label(rep,split),r["rows"]+"/"+r["scenarios"],"/".join(format(float(x["macro_f1"]),".4f") for x in rr),"/".join(x["class3_underestimate_count"] for x in rr),r["class3_underestimate_denominator"],"/".join(x["low_false_positive_count"] for x in rr),r["low_false_positive_denominator"]])
assert expected==ev["tables"]["T01"]["rows"]
md=(qa/(stem+"-results.md")).read_text(encoding="utf-8")
observed_tables=[]; current=[]
for line in md.splitlines():
    if line.startswith("|"):
        parts=[x.strip() for x in line.split("|")[1:-1]]
        if parts and not all(re.fullmatch(r"-+",x) for x in parts):current.append(parts)
    elif current:
        observed_tables.append(current);current=[]
if current: observed_tables.append(current)
assert len(observed_tables)==6
assert [r[:-1] for r in observed_tables[0][1:]]==expected
for i,key in ((1,"T02"),(2,"T03"),(4,"T05"),(5,"T06")):
    assert [r[:-1] for r in observed_tables[i][1:]]==ev["tables"][key]["rows"]
for i,(rep,split) in enumerate(groups):
    joint=[r for r in rows if r["replicate"]==rep and r["split"]==split and r["case_id"].startswith("joint_")]
    for key,candidate,count,den in (("center","center","class3_underestimate_count","class3_underestimate_denominator"),("upper","sampled_upper","class3_underestimate_count","class3_underestimate_denominator"),("low","sampled_upper","low_false_positive_count","low_false_positive_denominator"),("review","center","disagreement_rows_numerator","disagreement_rows_denominator")):
        rr=[r for r in joint if r["candidate"]==candidate]; maximum=max(int(r[count]) for r in rr)
        actual={"numerator":maximum,"denominator":int(rr[0][den]),"ties":[r["case_id"] for r in rr if int(r[count])==maximum]}
        assert actual==ev["tables"]["T04"]["maxima"][i][key]
assert len(ev["tables"]["T05"]["rows"])==32
assert ev["disjointness"]["unique_ids"]==ev["disjointness"]["unique_fingerprints"]==1600
assert len(ev["formal_manifest"]["files"])==9 and len(ev["source_manifest"]["files"])==26
print(json.dumps({"passed":True,"json_syntax":"passed","claim_hash_bindings":len(ev["claims_registry"]),"main_rows_direct_csv_checked":len(expected),"main_numeric_fields_per_row":6,"all_markdown_tables_bound":6,"all_joint_rows":32,"joint_maxima_ties_checked":16,"formal_cells":len(rows),"code_hashes":len(p["analysis_code_sha256"]),"raw_utc_preserved":True},ensure_ascii=True))
'@
& 'D:/矿业/smart-mine-v2-balanced/.venv-data/Scripts/python.exe' -B -c $qaValidateCode
```

Actual validation stdout:

```json
{"passed": true, "json_syntax": "passed", "claim_hash_bindings": 115, "main_rows_direct_csv_checked": 8, "main_numeric_fields_per_row": 6, "all_markdown_tables_bound": 6, "all_joint_rows": 32, "joint_maxima_ties_checked": 16, "formal_cells": 324, "code_hashes": 14, "raw_utc_preserved": true}
```

Manual main-table comparison: opened actual CSV-selected rows and compared all eight main rows against Markdown table, including rows/scenarios, four-place C/U/P F1, each C/U/P underestimation count and support denominator, each C/U/P low false-positive count and true0 denominator. The direct CSV assertion independently passed these same fields. Review, event, all joint adverse and old/new tables were generated by keyed CSV selection and read through in the printed table audit; table-order/denominator/ties checks passed. Display provenance and normalization choices are recorded in evidence JSON.

## Self-review and retained concerns

Adverse findings were preserved:
- Exact A fresh_in_domain U under1/201, while event alert3 timely67/67. Other pre-crossing frames can still alert; a row miss is not necessarily a whole event miss.
- Strength+20 A U under4/201 and alert3 timely66/67 is a separate condition with one missed timely event.
- Strength+20 U under4/201,2/207,5/198,3/189; joint maxima8/201,3/207,7/198,7/189.
- A in joint PMP and PPP each has1/201 unmarked center underestimation.
- Exact U low false positives282/592,284/606,273/601,275/639; exact non-limit alert3 burden27/33,26/31,32/34,32/37.
- Exact A range/set coverage missing4/5 rows; other exact groups each missing1 set-inclusion row; strength+20 gaps retained.
- All groups have100/100 scenarios flagged under exact and strength+20; row burden around80–82% /67–69%. Review_required is an output flag, not performed human correction; actual human resource cost unmeasured.

Canonical nonduplication has1600 unique parameter fingerprints/IDs across1200 old+400 new scenes; no old/new or new/new duplicate. This describes novel parameter combinations under the same simulator. No new independent physical source, continuous-grid guarantee, confidence bound, field calibration, acceptance threshold or live integration. These limitations and pending human/technical gates remain prominent. No unresolved execution failure remains; technical/scientific approval is outside this executor's authority.

Legacy untracked paths preserved:

- docs/qa/2026-10-12-cloud-workflow-qa.json
- docs/qa/2026-10-12-cloud-workflow-restore-qa.json
- docs/qa/2026-10-12-release-baseline.json
- docs/qa/2026-10-12-static-release-hashes.json
- docs/qa/2026-10-13-cloud-workflow-hotfix-qa.json
- docs/qa/2026-10-13-cloud-workflow-upgrade-restore-qa.json
- docs/qa/2026-10-13-deepseek-proposal-tests.md
- docs/qa/2026-10-13-final-proxy-workflow-read-qa.json
- docs/qa/2026-10-13-static-release-hashes.json
- docs/qa/2026-10-13-teacher-feedback-release.md
- docs/superpowers/plans/2026-10-12-teacher-feedback-release.md

## Git staging/commit verification

Executed only with maintenance/gc disabled. Report itself was not staged. Literal stage/check/commit commands:

```powershell
git -c maintenance.auto=false -c gc.auto=0 add -f -- docs/qa/2026-10-13-roof-mechanics-fresh-cohort-results.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-evidence.json docs/qa/2026-10-13-roof-mechanics-fresh-cohort-tests.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-review.md
git -c maintenance.auto=false -c gc.auto=0 diff --cached --check
git -c maintenance.auto=false -c gc.auto=0 diff --cached --name-only
git -c maintenance.auto=false -c gc.auto=0 diff --cached --stat
git -c maintenance.auto=false -c gc.auto=0 commit -m 'docs: report fresh-seed frozen-model simulation recheck'
git -c maintenance.auto=false -c gc.auto=0 log -1 --format='%H%n%P%n%s'
git -c maintenance.auto=false -c gc.auto=0 show --format= --name-only HEAD
git -c maintenance.auto=false -c gc.auto=0 status --short
git -c maintenance.auto=false -c gc.auto=0 diff HEAD --stat
```

Initial cached diff check flagged one extra blank line at EOF in each of the four QA files. Removed only those blank lines with apply_patch, re-added the exact four paths and reran cached diff check; final exit0 and no diagnostics. Claim-bearing physical lines were unchanged. Git LF/CRLF notices described future checkout normalization; working-copy values/hashes remained validated.

Commit exit0: 797caeaea26131eab75adc69601f3a30dca1b99f,4files/4128insertions, parent085dfa9de1b6f126396289dd76c55be937f1c547. Git emitted an auxiliary MSYS sh.exe NtCreateDirectoryObject0xC0000022 error before its successful summary, as the earlier Task1 commit had; verified commit object, parent and exact file membership using log/show. No Git environment repair attempted.

Final status contained only the same eleven pre-existing untracked paths; tracked diff HEAD was empty. Re-ran the same byte-only document validator after the EOF fix/commit (no inference) to check claim line/hash stability: exit0,115claims,8directCSVmainrows,6tables,32jointrows,16complete maxima/ties,324CSVrows,14codehashes,rawUTCpreserved. Four-file QA commit verified; Task2 technical reviewer/final whole-phase review pending as required.

