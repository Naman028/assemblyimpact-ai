"""Check 3 of 3: the oracle output must reproduce the fixed values quoted from the
handbook in the owner's M04 kickoff text. Hard-coded on purpose (no shared logic)."""
import json, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "m04"


class HandbookValues(unittest.TestCase):
    def setUp(self):
        self.case = json.loads((ROOT / "DS-ORACLE-01" / "expected-results.json").read_text())["cases"][0]

    def test_case_identity(self):
        self.assertEqual(self.case["caseNumber"], "EC-000473")
        self.assertEqual(self.case["status"], "COMPLETE")

    def test_cost_per_assembly(self):
        self.assertEqual(self.case["cost"]["fromPerAssembly"], "56.00")
        self.assertEqual(self.case["cost"]["toPerAssembly"], "68.00")

    def test_cost_delta_for_100(self):
        self.assertEqual(self.case["cost"]["productionQuantity"], 100)
        self.assertEqual(self.case["cost"]["deltaTotal"], "1200.00")

    def test_stock_gaps(self):
        s = {l["material"]: (l["required"], l["available"], l["gap"]) for l in self.case["stock"]}
        self.assertEqual(s["FAN-B"], ("100", "80", "20"))
        self.assertEqual(s["BRKT-01"], ("300", "250", "50"))

    def test_bom_changes(self):
        c = {l["itemNo"]: (l["fromMaterial"], l["toMaterial"], l["change"]) for l in self.case["comparison"]}
        self.assertEqual(c["0010"], ("FAN-A", "FAN-B", "REPLACED"))
        self.assertEqual(c["0020"], ("BRKT-01", "BRKT-01", "QUANTITY_CHANGED"))
        self.assertEqual(c["0030"], ("SENS-01", "SENS-01", "UNCHANGED"))
        self.assertEqual(c["0040"], (None, "SEAL-01", "ADDED"))

    def test_one_outdated_instruction_reference(self):
        out = [f for f in self.case["findings"] if f["type"] == "OUTDATED_INSTRUCTION_REFERENCE"]
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["material"], "FAN-A")

    def test_mockup_values_are_not_reproduced(self):
        # The concept mockup shows +1,250 EUR and ~+6.2 %; the canonical fixture must not.
        self.assertNotEqual(self.case["cost"]["deltaTotal"], "1250.00")
        self.assertEqual(self.case["cost"]["deltaPercent"], "21.43")


if __name__ == "__main__":
    unittest.main(verbosity=2)
