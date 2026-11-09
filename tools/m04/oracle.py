#!/usr/bin/env python3
"""
AssemblyImpact AI - M04 independent expected-results oracle (ruleset 1.1.0).

Deterministic reference implementation used ONLY to derive expected test results
from the synthetic fixtures. It is deliberately independent of the future CAP
implementation (different language, exact Decimal arithmetic, no shared code).

Usage:
  python3 oracle.py <dataset_dir> [--out expected-results.json]
  python3 oracle.py --negative <DS-NEG-01/cases.json> --base-root <fixtures_dir>
"""
import csv, json, sys, copy, argparse
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, date, timedelta
from pathlib import Path

RULESET = "1.1.0"
RUN_CURRENCY = "EUR"
STALE_AFTER_DAYS = 7
TWO = Decimal("0.01")

FILES = ["assemblies", "materials", "bom_states", "bom_items", "cost_prices",
         "stock_snapshots", "instructions", "instruction_references", "review_cases"]


def load(dataset_dir):
    d = Path(dataset_dir)
    data = {}
    for name in FILES:
        p = d / f"{name}.csv"
        with p.open(newline="") as fh:
            data[name] = [dict(r) for r in csv.DictReader(fh)]
    data["manifest"] = json.loads((d / "manifest.json").read_text())
    return data


def fmt(x):
    return None if x is None else format(Decimal(x).normalize(), "f")


def money(x):
    return None if x is None else str(Decimal(x).quantize(TWO, rounding=ROUND_HALF_UP))


class Reject(Exception):
    def __init__(self, code, detail):
        super().__init__(code)
        self.code, self.detail = code, detail


def evaluate_case(data, case, reference_date):
    ref_day = date.fromisoformat(reference_date)
    ref_time = datetime.fromisoformat(reference_date + "T23:59:59+00:00")
    states = {s["bomStateId"]: s for s in data["bom_states"]}

    # ---- validation (R-VAL) ----
    try:
        qty = Decimal(case["productionQuantity"])
    except Exception:
        raise Reject("INVALID_PRODUCTION_QUANTITY", case["productionQuantity"])
    if qty != qty.to_integral_value() or qty < 1:
        raise Reject("INVALID_PRODUCTION_QUANTITY", case["productionQuantity"])
    if case["fromBomStateId"] not in states or case["toBomStateId"] not in states:
        raise Reject("MISSING_BOM_STATE", f'{case["fromBomStateId"]}/{case["toBomStateId"]}')
    s_from, s_to = states[case["fromBomStateId"]], states[case["toBomStateId"]]
    for key in ("assemblyCode", "plant", "bomUsage", "alternative"):
        if s_from[key] != s_to[key]:
            raise Reject("NON_COMPARABLE_BOM_STATES", f"{key}: {s_from[key]} vs {s_to[key]}")
    if s_from["plant"] != case["plant"] or s_from["assemblyCode"] != case["assemblyCode"]:
        raise Reject("CASE_BOM_MISMATCH", "case assembly/plant differs from BOM state")
    # R-VAL-AMB: more than one state for the same revision/usage/alternative with overlapping validity
    for s in (s_from, s_to):
        same = [x for x in data["bom_states"] if x is not s and all(
            x[k] == s[k] for k in ("assemblyCode", "plant", "bomUsage", "alternative", "revision"))]
        for x in same:
            if x["validFrom"] <= s["validTo"] and s["validFrom"] <= x["validTo"]:
                raise Reject("AMBIGUOUS_BOM_STATE", f'{s["bomStateId"]} overlaps {x["bomStateId"]}')

    def items(state_id):
        rows = [r for r in data["bom_items"] if r["bomStateId"] == state_id]
        seen = set()
        for r in rows:
            q = Decimal(r["quantity"])
            if q <= 0:
                raise Reject("INVALID_BOM_QUANTITY", f'{state_id}/{r["itemNo"]}={r["quantity"]}')
            if r["itemNo"] in seen:
                raise Reject("DUPLICATE_ITEM_NUMBER", f'{state_id}/{r["itemNo"]}')
            seen.add(r["itemNo"])
        return {r["itemNo"]: r for r in rows}

    a_items, b_items = items(s_from["bomStateId"]), items(s_to["bomStateId"])
    findings = []
    run_flags = set()

    # ---- BOM comparison (R-CMP) ----
    comparison = []
    for pos in sorted(set(a_items) | set(b_items)):
        a, b = a_items.get(pos), b_items.get(pos)
        line = {"itemNo": pos,
                "fromMaterial": a["material"] if a else None,
                "fromQuantity": a["quantity"] if a else None,
                "toMaterial": b["material"] if b else None,
                "toQuantity": b["quantity"] if b else None,
                "unit": (b or a)["unit"]}
        if a and b and a["unit"] != b["unit"]:
            line["change"] = "NON_COMPARABLE"
            line["unit"] = None
            run_flags.add("NON_COMPARABLE_UNIT")
        elif a and not b:
            line["change"] = "REMOVED"
        elif b and not a:
            line["change"] = "ADDED"
        elif a["material"] != b["material"]:
            line["change"] = "REPLACED"
        elif Decimal(a["quantity"]) != Decimal(b["quantity"]):
            line["change"] = "QUANTITY_CHANGED"
        else:
            line["change"] = "UNCHANGED"
        comparison.append(line)
        ftype = {"REPLACED": "COMPONENT_REPLACED", "REMOVED": "COMPONENT_REMOVED",
                 "ADDED": "COMPONENT_ADDED", "QUANTITY_CHANGED": "QUANTITY_CHANGED",
                 "NON_COMPARABLE": "NON_COMPARABLE_UNIT"}.get(line["change"])
        if ftype:
            sev = {"COMPONENT_REPLACED": "MEDIUM", "COMPONENT_REMOVED": "MEDIUM",
                   "COMPONENT_ADDED": "LOW", "QUANTITY_CHANGED": "LOW",
                   "NON_COMPARABLE_UNIT": "HIGH"}[ftype]
            findings.append({"type": ftype, "severity": sev,
                             "material": line["toMaterial"] or line["fromMaterial"],
                             "fromMaterial": line["fromMaterial"], "toMaterial": line["toMaterial"],
                             "fromQuantity": line["fromQuantity"], "toQuantity": line["toQuantity"],
                             "evidenceRefs": [r["evidenceRef"] for r in (a, b) if r]})

    # ---- Cost (R-COST) ----
    def unit_price(material, unit):
        cands = [p for p in data["cost_prices"]
                 if p["material"] == material and p["plant"] == case["plant"]
                 and p["validFrom"] <= reference_date <= p["validTo"]]
        if not cands:
            return None, "MISSING_PRICE", None
        if len(cands) > 1:
            return None, "AMBIGUOUS_PRICE", None
        p = cands[0]
        if p["currency"] != RUN_CURRENCY:
            return None, "NON_COMPARABLE_CURRENCY", p["evidenceRef"]
        if p["unit"] != unit:
            return None, "NON_COMPARABLE_PRICE_UNIT", p["evidenceRef"]
        pu = Decimal(p["priceUnit"])
        if pu <= 0 or Decimal(p["price"]) < 0:
            return None, "INVALID_PRICE", p["evidenceRef"]
        return Decimal(p["price"]) / pu, None, p["evidenceRef"]

    def bom_cost(item_map):
        total, issues, lines = Decimal(0), [], []
        for pos in sorted(item_map):
            r = item_map[pos]
            up, issue, ev = unit_price(r["material"], r["unit"])
            if issue:
                issues.append({"material": r["material"], "issue": issue})
                lines.append({"itemNo": pos, "material": r["material"], "unitPrice": None, "lineCost": None})
                continue
            lc = Decimal(r["quantity"]) * up
            total += lc
            lines.append({"itemNo": pos, "material": r["material"], "unitPrice": fmt(up),
                          "lineCost": fmt(lc), "priceEvidenceRef": ev})
        return (None if issues else total), issues, lines

    cost_a, issues_a, lines_a = bom_cost(a_items)
    cost_b, issues_b, lines_b = bom_cost(b_items)
    cost = {"currency": RUN_CURRENCY, "productionQuantity": int(qty),
            "fromPerAssembly": money(cost_a), "toPerAssembly": money(cost_b),
            "fromLines": lines_a, "toLines": lines_b,
            "issues": issues_a + issues_b}
    if cost_a is None or cost_b is None or "NON_COMPARABLE_UNIT" in run_flags:
        cost.update({"status": "INCOMPLETE", "deltaPerAssembly": None, "fromTotal": None,
                     "toTotal": None, "deltaTotal": None, "deltaPercent": None})
        run_flags.add("COST_INCOMPLETE")
    else:
        delta = cost_b - cost_a
        pct = None if cost_a == 0 else (delta / cost_a * 100)
        cost.update({"status": "COMPLETE", "deltaPerAssembly": money(delta),
                     "fromTotal": money(cost_a * qty), "toTotal": money(cost_b * qty),
                     "deltaTotal": money(delta * qty),
                     "deltaPercent": None if pct is None else money(pct)})
        if delta != 0:
            findings.append({"type": "COST_CHANGE",
                             "severity": "MEDIUM" if pct is None or abs(pct) >= 5 else "LOW",
                             "material": None, "deltaTotal": money(delta * qty),
                             "deltaPercent": None if pct is None else money(pct),
                             "evidenceRefs": sorted({l["priceEvidenceRef"] for l in lines_a + lines_b
                                                     if l.get("priceEvidenceRef")})})

    # ---- Stock (R-STK) on target revision ----
    required = {}
    for r in b_items.values():
        key = (r["material"], r["unit"])
        required[key] = required.get(key, Decimal(0)) + Decimal(r["quantity"]) * qty
    stock_lines = []
    for (mat, unit) in sorted(required):
        snaps = [s for s in data["stock_snapshots"] if s["material"] == mat and s["plant"] == case["plant"]
                 and datetime.fromisoformat(s["snapshotAt"].replace("Z", "+00:00")) <= ref_time]
        line = {"material": mat, "unit": unit, "required": fmt(required[(mat, unit)])}
        if not snaps:
            line.update({"available": None, "gap": None, "status": "UNKNOWN", "stale": False})
            run_flags.add("STOCK_UNKNOWN")
        else:
            s = max(snaps, key=lambda x: x["snapshotAt"])
            if s["unit"] != unit:
                line.update({"available": None, "gap": None, "status": "NON_COMPARABLE", "stale": False})
                run_flags.add("STOCK_NON_COMPARABLE")
            else:
                avail = Decimal(s["availableQuantity"])
                gap = max(required[(mat, unit)] - avail, Decimal(0))
                snap_day = datetime.fromisoformat(s["snapshotAt"].replace("Z", "+00:00")).date()
                stale = (ref_day - snap_day) > timedelta(days=STALE_AFTER_DAYS)
                line.update({"available": fmt(avail), "gap": fmt(gap),
                             "status": "SHORT" if gap > 0 else "SUFFICIENT", "stale": stale,
                             "snapshotAt": s["snapshotAt"], "evidenceRef": s["evidenceRef"]})
                if stale:
                    run_flags.add("STOCK_STALE")
                if gap > 0:
                    findings.append({"type": "STOCK_GAP", "severity": "HIGH", "material": mat,
                                     "required": line["required"], "available": line["available"],
                                     "gap": line["gap"], "evidenceRefs": [s["evidenceRef"]]})
        stock_lines.append(line)

    # ---- Instructions (R-INS) ----
    target_rev = s_to["revision"]
    target_materials = {r["material"] for r in b_items.values()}
    candidates = [i for i in data["instructions"] if i["assemblyCode"] == case["assemblyCode"]
                  and i["plant"] == case["plant"] and i["status"] == "RELEASED"
                  and i["appliesToRevision"] in ("", target_rev)
                  and i["validFrom"] <= s_to["validFrom"]]  # R-INS-1: effective at target BOM validity start
    latest = {}
    for i in candidates:
        if i["instructionId"] not in latest or int(i["version"]) > int(latest[i["instructionId"]]["version"]):
            latest[i["instructionId"]] = i
    instr_lines = []
    for iid in sorted(latest):
        i = latest[iid]
        refs = [r for r in data["instruction_references"]
                if r["instructionId"] == iid and r["version"] == i["version"]]
        outdated = [r for r in refs if r["material"] not in target_materials]
        instr_lines.append({"instructionId": iid, "version": int(i["version"]),
                            "status": "NEEDS_UPDATE" if outdated else "CONSISTENT",
                            "outdatedSteps": [r["step"] for r in outdated]})
        for r in outdated:
            findings.append({"type": "OUTDATED_INSTRUCTION_REFERENCE", "severity": "HIGH",
                             "material": r["material"], "instructionId": iid,
                             "instructionVersion": int(i["version"]), "step": r["step"],
                             "evidenceRefs": [i["evidenceRef"]]})

    summary = {
        "instructionFindings": sum(1 for f in findings if f["type"] == "OUTDATED_INSTRUCTION_REFERENCE"),
        "instructionsToUpdate": sum(1 for l in instr_lines if l["status"] == "NEEDS_UPDATE"),
        "materialsShort": sum(1 for l in stock_lines if l["status"] == "SHORT"),
        "materialsUnknown": sum(1 for l in stock_lines if l["status"] in ("UNKNOWN", "NON_COMPARABLE")),
        "costDeltaTotal": cost["deltaTotal"], "costDeltaPercent": cost["deltaPercent"],
        "findingsBySeverity": {s: sum(1 for f in findings if f["severity"] == s) for s in ("HIGH", "MEDIUM", "LOW")},
    }
    status = "COMPLETE" if not run_flags else "INCOMPLETE"
    if run_flags == {"STOCK_STALE"}:
        status = "COMPLETE_WITH_WARNINGS"
    return {"caseNumber": case["caseNumber"], "status": status, "flags": sorted(run_flags),
            "from": {"bomStateId": s_from["bomStateId"], "revision": s_from["revision"]},
            "to": {"bomStateId": s_to["bomStateId"], "revision": s_to["revision"]},
            "comparison": comparison, "cost": cost, "stock": stock_lines,
            "instructions": instr_lines, "findings": findings, "summary": summary}


def run_dataset(data):
    ref = data["manifest"]["referenceDate"]
    out = {"datasetId": data["manifest"]["datasetId"], "datasetVersion": data["manifest"]["version"],
           "ruleset": RULESET, "referenceDate": ref, "synthetic": True, "cases": []}
    for case in data["review_cases"]:
        try:
            out["cases"].append(evaluate_case(data, case, ref))
        except Reject as r:
            out["cases"].append({"caseNumber": case["caseNumber"], "status": "REJECTED",
                                 "errorCode": r.code, "detail": r.detail})
    return out


def apply_mutations(data, mutations):
    data = copy.deepcopy(data)
    for m in mutations:
        rows = data[m["file"]]
        match = lambda r: all(r.get(k) == v for k, v in m.get("where", {}).items())
        if m["op"] == "delete":
            data[m["file"]] = [r for r in rows if not match(r)]
        elif m["op"] == "update":
            hits = [r for r in rows if match(r)]
            if not hits:
                raise SystemExit(f"mutation matched nothing: {m}")
            for r in hits:
                r.update(m["set"])
        elif m["op"] == "append":
            rows.append(dict(m["row"]))
        else:
            raise SystemExit(f"unknown op {m['op']}")
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--negative")
    ap.add_argument("--base-root")
    a = ap.parse_args()
    if a.negative:
        spec = json.loads(Path(a.negative).read_text())
        results, failures = [], 0
        for c in spec["cases"]:
            base = load(Path(a.base_root) / c["baseDataset"])
            res = run_dataset(apply_mutations(base, c["mutations"]))
            case = next(x for x in res["cases"] if x["caseNumber"] == c["caseNumber"])
            got = {"status": case["status"], "errorCode": case.get("errorCode"),
                   "flags": case.get("flags", [])}
            exp = c["expected"]
            ok = got["status"] == exp["status"] and got["errorCode"] == exp.get("errorCode") \
                and set(exp.get("flagsInclude", [])) <= set(got["flags"])
            for path, val in exp.get("checks", {}).items():
                cur = case
                for part in path.split("."):
                    cur = cur[int(part)] if isinstance(cur, list) else cur.get(part)
                ok = ok and cur == val
            failures += 0 if ok else 1
            results.append({"id": c["id"], "ok": ok, "got": got})
            print(f'{"PASS" if ok else "FAIL"} {c["id"]}: {got}')
        print(f"negative cases: {len(results)} total, {failures} failed")
        sys.exit(1 if failures else 0)
    data = load(a.dataset)
    out = run_dataset(data)
    text = json.dumps(out, indent=2)
    if a.out:
        Path(a.out).write_text(text + "\n")
    else:
        print(text)


if __name__ == "__main__":
    main()
