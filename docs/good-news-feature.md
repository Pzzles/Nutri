# Good News Feature — Implementation Plan

## What it does

When the user has a significant calorie surplus over a rolling period, the Dashboard shows a
small, dismissible notification: "You've banked X kcal this week — tonight could be a treat meal."

The period is configurable (weekly by default). Settings live in the Account page.

---

## Threshold rule

```
period_days    = 7 (weekly) | 30 (monthly) | N (custom)
period_budget  = target_calories × period_days
total_consumed = sum of logged calories over the last period_days rolling days
surplus        = period_budget − total_consumed
threshold      = period_budget × 0.10   ← 10% of the period budget

show notification if:
  target_calories is not null
  AND surplus >= threshold
```

A 1,800 kcal/day user on a weekly period: budget = 12,600 kcal, threshold = 1,260 kcal.
The notification only appears when the surplus clears 1,260 kcal.

---

## 1. Database migration

**File:** `supabase/migrations/0032_good_news_period.sql`

```sql
alter table profiles
  add column good_news_period_type text not null default 'weekly'
    check (good_news_period_type in ('weekly', 'monthly', 'custom')),
  add column good_news_custom_days integer check (good_news_custom_days >= 1);
```

No grants needed — the existing `profiles` RLS policies already cover select/update by the
owning user.

---

## 2. Backend — `dashboard-summary` edge function

File: `supabase/functions/dashboard-summary/index.ts`

### 2a. Read the period preference from profiles

Extend the existing profiles query (line 30) to also select the two new columns:

```ts
const { data: profile } = await service
  .from("profiles")
  .select("timezone, good_news_period_type, good_news_custom_days")
  .eq("id", userId)
  .single();
```

Derive the number of rolling days:

```ts
const periodType = profile?.good_news_period_type ?? "weekly";
const periodDays =
  periodType === "monthly" ? 30
  : periodType === "custom" ? (profile?.good_news_custom_days ?? 7)
  : 7;
```

### 2b. Fetch rolling-period calorie total

Add a new parallel query alongside the existing six (in the `Promise.all` block). Query meals
for the last `periodDays` days (exclusive of today only when `periodDays > 7`, otherwise the
existing `week_trend` already covers it — still run the query independently for correctness):

```ts
// Compute the rolling-period start date using the same UTC date math as weekDays.
const periodDays_window: string[] = [];
for (let i = periodDays - 1; i >= 0; i--) {
  periodDays_window.push(
    new Date(Date.UTC(y, mo - 1, dy - i)).toISOString().slice(0, 10)
  );
}
const periodStart = periodDays_window[0];

// Add to Promise.all:
service
  .from("meals")
  .select("id, logged_date")
  .eq("user_id", userId)
  .gte("logged_date", periodStart)
  .lte("logged_date", date),
```

Then fetch items for those meals (same two-pass pattern as the `week_trend` block), sum
`calories`, and compute surplus:

```ts
const periodConsumed = /* sum of calories over periodDays_window */;
const targetCalories = targets?.target_calories ?? null;
const periodBudget = targetCalories != null ? targetCalories * periodDays : null;
const surplus = periodBudget != null ? periodBudget - periodConsumed : null;
const threshold = periodBudget != null ? periodBudget * 0.10 : null;
const showGoodNews =
  surplus != null && threshold != null && surplus >= threshold;
```

### 2c. Add `good_news` to the response payload

Append to the `ok({...})` return value:

```ts
good_news: {
  show: showGoodNews,
  surplus_kcal: surplus != null ? round(surplus) : null,
  period_days: periodDays,
  period_type: periodType,
},
```

When `target_calories` is null, `show` is `false` and both `surplus_kcal` and `period_days` are
still present (non-null) so the frontend can render a "set a goal first" state if needed later.
For now the component simply does not render when `show` is false.

---

## 3. Frontend — `DashboardData` interface

File: `web/src/pages/Dashboard.tsx`

Add to the `DashboardData` interface (after line 26):

```ts
good_news: {
  show: boolean;
  surplus_kcal: number | null;
  period_days: number;
  period_type: "weekly" | "monthly" | "custom";
} | null;
```

`null` is the safe default for existing data shapes before the backend is deployed.

---

## 4. Frontend — `GoodNewsNotification` component

**New file:** `web/src/components/GoodNewsNotification.tsx`

### Props

```ts
interface Props {
  surplusKcal: number;
  periodDays: number;
  periodType: "weekly" | "monthly" | "custom";
}
```

### Dismiss logic

Use localStorage. Key: `good-news-dismissed` → value: today's date string `YYYY-MM-DD`.
On mount, read the key. If the stored date equals today, render nothing. On dismiss, write today's
date to the key.

```ts
const TODAY = new Date().toLocaleDateString("en-CA"); // "YYYY-MM-DD"

const [dismissed, setDismissed] = useState(() => {
  try {
    return localStorage.getItem("good-news-dismissed") === TODAY;
  } catch {
    return false;
  }
});

function dismiss() {
  try { localStorage.setItem("good-news-dismissed", TODAY); } catch {}
  setDismissed(true);
}

if (dismissed) return null;
```

### Period label helper

```ts
function periodLabel(type: string, days: number): string {
  if (type === "weekly") return "this week";
  if (type === "monthly") return "this month";
  return `the last ${days} days`;
}
```

### UI — collapsed state (pill)

A single line, sits below the macro card on the Dashboard. No overlay, no blocking.

```tsx
<div className="flex items-center gap-2 rounded-full border border-green-300 bg-green-50
                px-3 py-1.5 text-sm text-green-800 dark:border-green-700 dark:bg-green-950
                dark:text-green-300">
  <span>You've banked {surplusKcal} kcal {periodLabel(periodType, periodDays)}</span>
  <button
    onClick={dismiss}
    aria-label="Dismiss"
    className="ml-auto text-green-600 hover:text-green-800 dark:text-green-400"
  >
    ×
  </button>
</div>
```

Keep it to one line. No expand/collapse. The pill is self-contained — surplus amount + period
label + dismiss. If the user wants to act on it, they go log a meal.

---

## 5. Dashboard integration

File: `web/src/pages/Dashboard.tsx`

Import the component (top of file):

```ts
import GoodNewsNotification from "../components/GoodNewsNotification";
```

Render it after the macro ring card and before the Meals widget (between lines 102 and 104):

```tsx
{data.good_news?.show && data.good_news.surplus_kcal != null && (
  <GoodNewsNotification
    surplusKcal={data.good_news.surplus_kcal}
    periodDays={data.good_news.period_days}
    periodType={data.good_news.period_type}
  />
)}
```

No state needed in Dashboard for this — the component manages its own dismissed state.

---

## 6. Account page — period settings

File: `web/src/pages/AccountLink.tsx`

### 6a. State

Add to existing state declarations:

```ts
type GoodNewsPeriodType = "weekly" | "monthly" | "custom";

const [goodNewsPeriod, setGoodNewsPeriod] = useState<GoodNewsPeriodType>("weekly");
const [goodNewsCustomDays, setGoodNewsCustomDays] = useState<string>("7");
const [goodNewsSaving, setGoodNewsSaving] = useState(false);
const [goodNewsSaved, setGoodNewsSaved] = useState(false);
const [goodNewsError, setGoodNewsError] = useState<string | null>(null);
```

### 6b. Load preference in `loadHealthProfile`

Extend the existing profiles query to also select the two new columns:

```ts
.select("birth_date, sex, height_cm, good_news_period_type, good_news_custom_days")
```

After the existing `setHealthProfile(...)` call:

```ts
setGoodNewsPeriod(data?.good_news_period_type ?? "weekly");
setGoodNewsCustomDays(String(data?.good_news_custom_days ?? 7));
```

### 6c. Save function

```ts
async function saveGoodNewsPeriod() {
  setGoodNewsSaving(true);
  setGoodNewsError(null);
  setGoodNewsSaved(false);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const customDays = parseInt(goodNewsCustomDays, 10);
    const { error } = await supabase
      .from("profiles")
      .update({
        good_news_period_type: goodNewsPeriod,
        good_news_custom_days: goodNewsPeriod === "custom" ? customDays : null,
      })
      .eq("id", user.id);
    if (error) throw error;

    setGoodNewsSaved(true);
    setTimeout(() => setGoodNewsSaved(false), 3000);
  } catch (err: any) {
    setGoodNewsError(err.message ?? "Could not save preference.");
  } finally {
    setGoodNewsSaving(false);
  }
}
```

### 6d. Validation

The Save button is disabled when:
- `goodNewsPeriod === "custom"` AND (`isNaN(parseInt(goodNewsCustomDays))` OR `parseInt(goodNewsCustomDays) < 1`)

### 6e. "Too soon to tell" warning

Derive the effective number of days from the current selection:

```ts
const effectiveDays =
  goodNewsPeriod === "monthly" ? 30
  : goodNewsPeriod === "custom" ? (parseInt(goodNewsCustomDays) || 0)
  : 7;
```

Show the warning when `effectiveDays > 0 && effectiveDays < 7`:

```tsx
{effectiveDays > 0 && effectiveDays < 7 && (
  <p className="text-xs text-amber-700 dark:text-amber-400">
    Short windows can be misleading — we recommend at least 7 days.
  </p>
)}
```

This is a warning, not a block. The Save button remains enabled.

### 6f. UI section

Add a new section in AccountLink, after the health profile card and before the password/account
management section:

```
Good news notifications
[●] Weekly   [○] Monthly   [○] Custom: [__7__] days
                                        ↑ number input, min=1, only visible when Custom is selected
[Too soon to tell warning — if effectiveDays < 7]
[Save]  [Saved ✓ / error message]
```

Use the same visual pattern as the health profile form:
- Section heading: `text-sm font-semibold text-ink`
- Radio labels: `text-sm text-ink`  
- Inline error: `text-sm text-confidence-low`
- Inline success: `text-sm text-confidence-high`
- Save button: matches existing profile save button class

---

## 7. Constraints and edge cases

| Case | Behaviour |
|---|---|
| No active goal / `target_calories` is null | `good_news.show = false` — notification never renders |
| User has not logged anything in the period | `total_consumed = 0`, surplus = full budget — will show if ≥ threshold. This is correct: they are genuinely under. |
| Custom period with `good_news_custom_days = null` (DB) | Backend defaults to 7 days. Frontend defaults input to `"7"`. |
| localStorage unavailable (private window) | `try/catch` in both read and write; component defaults to showing (not dismissed). |
| Surplus < threshold | `show = false`. No notification. |
| User dismisses — then logs more food — surplus drops below threshold | Notification stays dismissed for the day regardless. The surplus is re-evaluated fresh the next day. |
| User dismisses — then logs more food — still above threshold the next day | localStorage key is keyed to today's date, so it resets at midnight automatically. |

---

## 8. What this feature does NOT do

- It does not suggest specific foods or portion sizes.
- It does not calculate or display a TDEE or BMR.
- It does not fire at a specific time of day (no push notifications, no scheduled jobs).
- It does not persist the dismissed state server-side — localStorage per device is sufficient.
- The "too soon to tell" warning is informational only; it does not block saving.

---

## Implementation order

1. `0032_good_news_period.sql` — migration
2. `dashboard-summary/index.ts` — backend changes
3. `GoodNewsNotification.tsx` — new component
4. `Dashboard.tsx` — interface update + component render
5. `AccountLink.tsx` — settings section

Each step is independently deployable in this order. The Dashboard renders `good_news?.show`
with optional chaining, so the frontend is safe before the backend is deployed. The component
is only mounted when `show === true`.
