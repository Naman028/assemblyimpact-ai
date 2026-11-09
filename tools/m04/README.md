# M04 expected-results tools (development only)

Independent generators/checkers for the synthetic fixtures in `test/fixtures/m04`
(ruleset 1.1.0). They are not part of the application and are not run by `npm test`;
`test/impact-calculator.test.js` compares the CAP calculator with their committed output.

Run from `test/fixtures/m04`:

    python3 ../../../tools/m04/oracle.py DS-ORACLE-01 --out DS-ORACLE-01/expected-results.json
    python3 ../../../tools/m04/oracle.py --negative DS-NEG-01/cases.json --base-root .
    node ../../../tools/m04/crosscheck.mjs DS-ORACLE-01
    python3 ../../../tools/m04/test_handbook_values.py

Seed data for the CAP development profile (`test/data`, M04 Slice 1b), from the repo root:

    node tools/m04/build-seed.mjs           # regenerate test/data/*.csv
    node tools/m04/build-seed.mjs --check   # exit 1 if test/data is out of date
