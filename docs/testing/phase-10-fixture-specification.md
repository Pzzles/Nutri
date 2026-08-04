# Phase 10 remediation fixture specification

Gate 3 fixtures are deterministic and exercise:

1. irregular, sparse ordering with no interpolation;
2. exact −0.5/+0.5 cm direction boundaries before rounding;
3. representative v2/v3 compatibility under protocol v1;
4. unknown protocol retention with comparisons suppressed;
5. optional context defaults, invalid types/enums/trusted fields, and all warning codes;
6. all four Phase 6 interval directions;
7. 14-day spacing, status, confidence, interval, staleness, and seven-day alignment gates;
8. server-derived local time and legacy context normalization;
9. 1,005 real local-Supabase finalised sessions across 11 bounded history pages;
10. `nutri_data_export_v3` context/provenance and account-deletion regression;
11. byte-equivalent Phase 5–8 canonical outputs before and after anthropometry calculation;
12. a static dependency proof that Phase 5–8 production modules neither import nor query anthropometry.

Pure fixtures live in `_shared/anthropometryProgress.test.ts` and `_shared/anthropometryNonInterference.test.ts`. Real database/API fixtures live in `anthropometry-api.test.ts`; Gate 2 concurrency, RLS, and deletion suites remain mandatory regression gates. Two clean `supabase db reset --local` executions and a schema diff are required before Gate 3 can be accepted.
