# P1 Node.js agent: live checks (2026-11-11)

## BTP (deployed main 01ffa2e, HANA Cloud, XSUAA user with ChangeAnalyst/ChangeViewer, plant 1000)
- Deploy: `cf deploy` from BAS, operation 70a4f011-dd6c-11f1-9220-eeee0a98edaa, both apps started, no service deleted.
- Investigation Studio tabs include **Assistant**; Cost cards render fully (text 35 px in a 35 px box; before: 23 px text in a 16 px box). Screenshot `UI-01-btp-cost-cards-not-clipped.jpg`.
- Question (button "Explain this impact"): "What is the impact of EC-000473? Explain cost, shortages and work instructions."
- Reply: ANSWERED by Google Gemini `gemini-3.5-flash-lite`, one CAP operation `getImpact` (= SAP Build Action `GetEngineeringImpact`):
  1200.00 EUR for 100 assemblies (21.43 %), 56.00 -> 68.00 EUR per assembly (+12.00); BRKT-01 300/250 gap 50, FAN-B 100/80 gap 20;
  WI-COOL-100-TST v2 step 0030 references FAN-A. All figures equal the HANA impact run. Screenshot `P1-02-node-agent-btp-live-cool100.jpg`.
- Nothing was written (read-only question).

## BAS (feature branch, `npm run dev:gemini`, SQLite, user analyst) - screenshot provided by the user
- "Which open cases have shortages?" -> ANSWERED by Gemini: EC-000473 BRKT-01 gap 50, FAN-B gap 20; operations: lookupCases + 6x getImpact.
  This motivated the tool budget and the "use lookupCases for lists" rule in PR #33.

Not shown live yet: the PR #33 additions (Action names and token count in the reply, AI-explanation tool) - they are in main only after #33 is merged and deployed.
