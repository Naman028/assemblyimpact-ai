# Administrator handoff: EU10 destination for the AssemblyImpact Joule assistant

**Purpose:** let Joule in SAP Build (EU10) call the AssemblyImpact CAP API (US10) as the signed-in user.

**Path:** EU10 Joule Studio → SAP Build destination variable `assemblyImpactBackend` → EU10 BTP destination → US10 CAP
OData API → existing SAP HANA Cloud.

Legend:
- **[V]** verified by us (evidence or a test in this repo);
- **[P]** proposed;
- **[A]** requires administrator confirmation.

No secret appears in this document or in the repository.

## 1. Tenants and environment

| Item | Value | Status |
|---|---|---|
| SAP Build tenant (Joule) | `sap-build-eu10-trial-2-97yhudg4`, region EU10. Joule Studio project *AssemblyImpact Engineering Assistant* | [V] |
| EU10 BTP subaccount that owns this SAP Build subscription | Name and subdomain unknown to us. The destination must be created **in this subaccount**, not in another user's | [A] |
| SAP Build environment for testing | *Private* environment of the developer user. It is active and has been used for tests | [V] |
| Our permissions in EU10 | No *Destinations* tile in Control Tower, and no BTP cockpit access to the EU10 subaccount | [V] |
| Backend subaccount | `78485bd6trial`, region US10, CF org `78485bd6trial`, space `dev`, XSUAA instance `assemblyimpact-auth` | [V] |
| Existing CAP API | `https://78485bd6trial-dev-assemblyimpact-srv.cfapps.us10-001.hana.ondemand.com/odata/v4/engineering-review` | [V] |

## 2. Authentication: options and the selected mechanism

| Option | Assessment | Status |
|---|---|---|
| **OAuth2SAMLBearerAssertion** (selected) | This is SAP's documented pattern for user propagation between Cloud Foundry subaccounts, including across regions. The EU10 destination service signs a SAML assertion for the signed-in user. US10 XSUAA trusts that signer as a SAML IdP and issues a US10 JWT for the same user. Supported in Actions destinations. | [P]; feasibility [A] |
| OAuth2JWTBearer (`destination.template.json`) | The EU10 user JWT is issued by the EU10 subaccount's XSUAA. US10 XSUAA's jwt-bearer grant would have to accept that foreign token, and it does not without a shared OIDC identity setup. Valid only inside one subaccount. **Not selected** for EU10 → US10. | [P] |
| OAuth2UserTokenExchange | Needs the user token to come from the same identity zone as the target. Same problem as above. | [P] |
| Client credentials / technical user | Rejected. It carries no `plants` attribute, so every call is refused (or plants would have to be configured on the server). It would also hide who ran a calculation. | [V] (`srv/engineering-review.js`: a missing `plants` attribute returns no cases) |

Sources: SAP Help *User Propagation between Cloud Foundry Applications* (connectivity, Cloud Foundry), and SAP's
"call protected app across regions with SAML and OAuth" tutorial series.

## 3. Prerequisites and configuration steps

**EU10, by the subaccount administrator** (role collection *Subaccount Administrator*, or *Destination Administrator*)

1. **[A]** Confirm which EU10 subaccount hosts the SAP Build subscription that the Joule project uses.
2. **[P]** *Connectivity → Destinations → Download IdP Metadata* (destination-service SAML metadata). Hand the file to
   the US10 administrator. It is public metadata, not a secret.
3. **[P]** Create the destination from `p1/joule/destination.eu10-saml-bearer.template.json` and remove its `_note` key.
   - **Proposed name:** `ASSEMBLYIMPACT_ENGINEERING`.
   - Take `audience` and the `tokenServiceURL` alias from `https://78485bd6trial.authentication.us10.hana.ondemand.com/saml/metadata`.
   - Enter the client ID and secret in the cockpit only.
4. **[P]** In SAP Build Control Tower → *Backend Configuration → Destinations*, add the destination, so that SAP
   Build can use it.
5. **[A]** In Control Tower → *Environments → Private (developer)*, make the destination available to the
   environment. This environment association is required before the test dialog lists it.

**US10, by the subaccount administrator of `78485bd6trial`** (the project owner holds this role)

6. **[P]** *Security → Trust Configuration → New Trust Configuration*: upload the EU10 destination-service IdP
   metadata from step 2.
   - Use a recognisable origin name, for example `eu10-build-destination`.
   - Do **not** change the default identity provider used for the Fiori apps.
7. **[P]** Credentials: create a **dedicated** service key on `assemblyimpact-auth`, for example `joule-eu10`, for
   step 3 only.
   - Rotate it by deleting and recreating the key.
   - Never paste it into chat, tickets or Git.
8. **[P]** Authorization. **This is the control. The destination does not narrow permissions.** For each Joule user,
   assign role collections **under the `eu10-build-destination` origin only**:
   - `AssemblyImpact_JouleReader` (ChangeViewer, plants `1000`) by default;
   - `AssemblyImpact_JouleImpactRunner` (ChangeViewer + ImpactRunner, plants `1000`) only for users allowed to
     recalculate.
   - Assign no Analyst, Approver, Importer or ERP-extractor collection under this origin.

   Users of this origin are separate shadow users, so their Fiori roles under the default IdP do not flow into Joule
   tokens. Check this in step 9.
9. **[A]** The user identifier must match: the destination's `nameIdFormat` (e-mail) must equal the user name the
   shadow user is created with in US10.

## 4. Read-only acceptance tests (in this order; no impact run on production data)

Run them in the Joule private environment after mapping `assemblyImpactBackend` to the destination.

| # | Test | Expected | Proves |
|---|---|---|---|
| 1 | *Engineering Case Lookup*, "Look up case EC-000473" (JouleReader user) | 200; exactly one case, `EC-000473`, plant `1000`, real title and status from HANA | Destination, trust and token exchange work. **A successful *Check Connection* alone is not acceptance.** |
| 2 | Same user: "Look up case EC-200473" (plant-2000 mirror) | 200 with an empty list | The plant attribute reaches CAP |
| 3 | "Explain the impact of EC-000473" | Run status, cost delta and currency (or "not available" if the run is INCOMPLETE), material gaps | Impact retrieval |
| 4 | "Show the decision history of EC-000473" | 200; decisions as stored (currently none) | Decision history |
| 5 | *Run Engineering Impact* → **Cancel** | "Impact run cancelled"; no POST in the CAP log | Cancel safety |
| 6 | *Run Engineering Impact* → Confirm, **JouleReader** user, on a **non-production test case** | 403 → "Impact run was refused" | Role separation |
| 7 | Decode the exchanged token. Use the CAP log or a debug endpoint in a non-production space only | `user_name` = the signed-in user; `origin` = `eu10-build-destination`; scopes are only the assigned Joule collection; `xs.user.attributes.plants` = `["1000"]` | Identity and attributes |

Only after tests 1–7 pass: release the Joule project and deploy it in SAP Build (authorized developer).

## 5. Failure diagnosis

| Symptom | Likely cause | Fix |
|---|---|---|
| Destination not offered in the Joule *Test* dialog | Not registered in Control Tower, or not assigned to the environment (steps 4–5) | Register and assign |
| 401 from the token endpoint | US10 trust missing or wrong metadata; wrong `audience` or token URL alias; wrong client | Re-check steps 3 and 6 |
| 200 but an empty list for EC-000473 | Token has no `plants` attribute, or the wrong plant | Role collection under the correct origin (step 8) |
| 403 on lookup | No ChangeViewer collection for the propagated user | Step 8 |
| Name mismatch: user created twice | `nameIdFormat` differs from the expected user name | Step 9 |
| 5xx | CAP or HANA unavailable (HANA trial stops nightly) | Start HANA; check `cf logs assemblyimpact-srv --recent` |

## 6. Rollback

All steps are additive. Undo them in reverse order:
1. Unmap the Joule variable.
2. Remove the destination from the environment and from Control Tower.
3. Delete the EU10 destination.
4. Delete the US10 trust configuration `eu10-build-destination`. This also removes its shadow users' role assignments.
5. Delete service key `joule-eu10`.

Nothing in CAP, HANA, XSUAA (`xs-security.json`), the CF apps or the Fiori apps changes.

## 7. Single next external action

An **EU10 subaccount administrator** for the subaccount hosting `sap-build-eu10-trial-2-97yhudg4` performs steps 1–5
and sends the IdP metadata. The US10 steps 6–8 can then be done by the project owner.
