# Pocket Ledger — Implementation Specification

## 1. Overview
Pocket Ledger is a native iPhone app for one person to record expenses, see the current month's total and spending by category, stay within a monthly budget, and export any month to CSV. It runs entirely on the device: no account, no server, no cloud sync. Goal: adding an expense takes under 10 seconds and the user always knows where the month stands against their budget.

## 2. Scope
**In scope**
- Add, edit, and delete expenses (amount, category, date, optional note).
- Current-month total and category breakdown chart.
- One monthly budget amount with an over-budget warning.
- Export a chosen month to a CSV file via the iOS share sheet.
- On-device storage only.

**Out of scope**
- Accounts, sign-in, iCloud or any network sync.
- Multiple currencies, currency conversion.
- Recurring expenses, income tracking, per-category budgets.
- iPad, Mac, and widget targets.

## 3. Requirements
- **R1** — User can add an expense with an amount, a category, a date, and an optional note.
- **R2** — User can edit every field of an existing expense.
- **R3** — User can delete an expense.
- **R4** — The app shows the sum of all expenses dated in the current calendar month.
- **R5** — The app shows a chart of the current month's spending by category.
- **R6** — User can set, change, and clear one monthly budget amount.
- **R7** — When the current month's total is greater than the budget, the app shows a warning on the Summary tab and a badge on the tab icon.
- **R8** — All data is stored only on the device; the app makes no network requests and has no account.
- **R9** — User can export all expenses of a chosen month to a CSV file.

## 4. Architecture
Single-target SwiftUI app, MVVM-lite: views read SwiftData directly with `@Query`; logic that needs testing lives in plain Swift types.

| Component | Responsibility | Talks to |
|---|---|---|
| `PocketLedgerApp` | App entry; creates the `ModelContainer`; seeds default categories on first launch | `CategorySeeder` |
| Views (`ExpensesView`, `ExpenseFormView`, `SummaryView`, `SettingsView`) | Display and user input only | SwiftData via `@Query` / `modelContext`, `MonthCalculator`, `BudgetStore`, `CSVExporter` |
| `MonthCalculator` | Pure functions: month date range, totals, per-category sums | none (takes arrays of `Expense`) |
| `BudgetStore` | Reads/writes the budget in `UserDefaults`; computes `isOverBudget` | `UserDefaults` |
| `CSVExporter` | Builds CSV text for a month and writes it to a temporary file | `FileManager` |
| `CategorySeeder` | Inserts the five default categories once | SwiftData |

**Data flow**
- *Add expense:* user taps "+" → `ExpenseFormView` validates fields → inserts `Expense` into `modelContext` → `modelContext.save()` → `@Query` in `ExpensesView` and `SummaryView` refreshes → totals recomputed by `MonthCalculator`.
- *Budget warning:* `SummaryView` gets the month total from `MonthCalculator` → `BudgetStore.isOverBudget(total)` → shows the warning card; `ContentView` sets the Summary tab `.badge("!")` from the same value.
- *Export:* user picks a month in Settings → `CSVExporter.makeFile(for:expenses:)` → temporary file URL → `ShareLink` presents the share sheet.

## 5. Tech stack
- Swift 5.10, Xcode 16, iOS 17.0 minimum deployment target.
- SwiftUI for UI, SwiftData for persistence, Swift Charts for the chart (all Apple frameworks, iOS 17+).
- XCTest for unit tests, XCUITest for UI tests.
- No third-party dependencies and no networking frameworks.

## 6. Data model
**`Expense`** (`@Model`)
| Field | Type | Required | Default / rule |
|---|---|---|---|
| `id` | `UUID` | yes | `UUID()` |
| `amountMinor` | `Int` | yes | amount in minor units (cents); 1…99,999,999 |
| `date` | `Date` | yes | today, stored at start of day in the device calendar |
| `note` | `String?` | no | nil; max 200 characters |
| `category` | `Category` | yes | relationship |
| `createdAt` | `Date` | yes | `Date.now` |

**`Category`** (`@Model`)
| Field | Type | Required | Default / rule |
|---|---|---|---|
| `id` | `UUID` | yes | `UUID()` |
| `name` | `String` | yes | unique; seeded: Food, Transport, Housing, Entertainment, Other |
| `colorHex` | `String` | yes | fixed palette per seeded category |
| `expenses` | `[Expense]` | — | inverse relationship |

Relationships: one `Category` has many `Expense`s. Categories are fixed in v1 (not user-editable), so a category is never deleted; delete rule `.deny`. Deleting an `Expense` has no cascade.

**Budget:** `UserDefaults` key `budget.monthlyMinor` (`Int?`); nil means no budget.

**Storage & migration:** SwiftData store in the app's default container. Models are declared in `SchemaV1` conforming to `VersionedSchema`, with a `PocketLedgerMigrationPlan` that has no stages yet. Future model changes add `SchemaV2` plus a lightweight or custom `MigrationStage`; a model is never edited in place.

## 7. Screens & UX states
Navigation: a `TabView` with three tabs — **Expenses** (start screen), **Summary**, **Settings**. The add/edit form is a sheet; dismissing it returns to the Expenses tab.

**Expenses tab**
- Header: current month name and total (e.g. "September · $412.30").
- List of current-month expenses, newest date first: category color dot, category name, note (1 line), amount, date.
- Actions: "+" toolbar button → add sheet; tap row → edit sheet; swipe left → Delete with confirmation dialog "Delete this expense?".
- Month switcher: chevrons to view previous months (read-only header totals update).
- Empty state: illustration + "No expenses this month" + "Add expense" button.
- Loading state: SwiftData queries are local and synchronous; no spinner. On first launch, seeding happens before the first frame.
- Error state: if a save or delete fails, show alert "Couldn't save your change. Please try again." and keep the list unchanged.

**Add / Edit expense sheet**
- Fields: Amount (decimal pad, locale currency symbol), Category (picker of the 5 categories, default Food), Date (date picker, default today, no future dates beyond today+1 year), Note (optional, 200-char limit with counter).
- Actions: Save (disabled until valid), Cancel. Edit mode adds a red "Delete expense" button.
- Validation errors appear inline under the field (see §9).

**Summary tab**
- Month total, budget progress bar ("$412.30 of $500.00"), and a Swift Charts `SectorMark` donut by category with a legend showing each category's amount and percentage.
- Over budget: red card "Over budget by $37.70" above the chart; tab badge "!".
- Empty state: "Add expenses to see your breakdown" instead of the chart.
- No budget set: progress bar replaced by a "Set a monthly budget" button that opens Settings.

**Settings tab**
- Monthly budget field (decimal pad) with Save and "Remove budget".
- Export: month picker (months that have expenses) + "Export CSV" `ShareLink`.
- Export empty state: if the selected month has no expenses, the button is disabled with caption "No expenses in this month".

## 8. Implementation plan
**File tree**
```
PocketLedger/
  PocketLedgerApp.swift        # app entry, ModelContainer, seeding
  ContentView.swift            # TabView + Summary badge
  Models/
    SchemaV1.swift             # Expense, Category @Model types
    MigrationPlan.swift        # PocketLedgerMigrationPlan
    CategorySeeder.swift       # inserts default categories once
  Logic/
    MonthCalculator.swift      # month range, totals, per-category sums
    BudgetStore.swift          # UserDefaults budget + isOverBudget
    CSVExporter.swift          # CSV text + temp file
    AmountParser.swift         # locale string -> minor units, validation
  Views/
    ExpensesView.swift
    ExpenseFormView.swift
    SummaryView.swift
    SettingsView.swift
PocketLedgerTests/
  MonthCalculatorTests.swift
  BudgetStoreTests.swift
  CSVExporterTests.swift
  AmountParserTests.swift
PocketLedgerUITests/
  CoreFlowsUITests.swift
```

**Build steps**
1. Create the Xcode project (iOS 17, SwiftUI, SwiftData), add test targets. *Check:* empty app builds and launches in the simulator.
2. Add `SchemaV1`, `MigrationPlan`, `CategorySeeder`; wire the container in `PocketLedgerApp`. *Check:* first launch creates exactly 5 categories (unit test with in-memory container).
3. Implement `AmountParser` and `MonthCalculator`. *Check:* `AmountParserTests`, `MonthCalculatorTests` pass.
4. Build `ExpensesView` and `ExpenseFormView` with add/edit/delete and validation. *Check:* AC-1, AC-2, AC-3 pass manually in the simulator.
5. Implement `BudgetStore` and `SettingsView` budget section. *Check:* `BudgetStoreTests` pass.
6. Build `SummaryView` with chart, progress bar, over-budget card, and tab badge. *Check:* AC-4, AC-5 pass.
7. Implement `CSVExporter` and the Settings export section. *Check:* `CSVExporterTests` pass; AC-6 passes on device.
8. Add `CoreFlowsUITests` for AC-1, AC-2, AC-4. *Check:* all tests green in CI (`xcodebuild test`).

## 9. Errors & edge cases
| Situation | Behavior |
|---|---|
| `modelContext.save()` throws on add/edit/delete | Roll back the context; alert "Couldn't save your change. Please try again."; form stays open with the user's input intact. |
| SwiftData container fails to load at launch | Full-screen message "Pocket Ledger couldn't open its data. Restart the app. If this keeps happening, reinstall." with no destructive action taken. |
| CSV file write fails | Alert "Couldn't create the export file." No partial file is shared. |
| Month with 0 expenses | Totals show 0; chart replaced by empty state; export disabled. |
| Expense date in a future month | Allowed up to today + 1 year; counts toward that month, not the current one. |
| Device locale/currency changes | Amounts are stored in minor units and re-formatted with the current locale; no conversion. |
| Budget exactly equal to total | Not over budget (warning only when total > budget). |
| Very large list (10,000+ expenses) | `@Query` filtered by month range with a `#Predicate`, so only one month loads. |

**Input validation**
| Field | Rule | Error shown |
|---|---|---|
| Amount | required; > 0; ≤ 999,999.99; max 2 decimal places | "Enter an amount greater than 0." / "Amount is too large." / "Use at most 2 decimal places." |
| Category | required (always has default) | — |
| Date | required; ≤ today + 1 year | "Date can't be more than a year ahead." |
| Note | optional; ≤ 200 characters | counter turns red; typing is blocked past 200 |
| Budget | optional; > 0; ≤ 9,999,999.99 | "Enter a budget greater than 0." |

Network: not applicable — the app makes no network requests (R8).

## 10. Security & privacy
- Accounts/sign-in: not applicable — no accounts (R8).
- Secrets: not applicable — the app uses no API keys or tokens.
- Sensitive data: expense amounts and notes are personal financial data. They are stored only in the app sandbox (SwiftData store + `UserDefaults`), protected by iOS Data Protection class `completeUntilFirstUserAuthentication` (default). No analytics, no crash reporting SDKs, no network entitlements used.
- CSV exports leave the sandbox only when the user explicitly shares them; temporary export files are deleted when the share sheet closes.
- Deletion: deleting an expense removes it immediately; deleting the app removes all data. The Settings tab explains "Your data never leaves this iPhone unless you export it."

## 11. Testing & acceptance criteria
**Strategy**
- Unit (XCTest): `AmountParser` (valid/invalid/locale inputs), `MonthCalculator` (month boundaries, time zones, empty month), `BudgetStore` (set/clear/equal/over), `CSVExporter` (header, escaping commas/quotes/newlines in notes, empty month), seeding (in-memory `ModelContainer`).
- UI (XCUITest): add → list/total update; edit; delete with confirmation; over-budget warning and badge.
- Failure cases: save failure simulated via a test hook that makes the context throw; CSV write failure via an unwritable URL.
- CI command: `xcodebuild test -scheme PocketLedger -destination 'platform=iOS Simulator,name=iPhone 16'`.

**Acceptance criteria**
- **AC-1** (R1, R4) — Given no expenses this month, when the user adds 12.50 in Food dated today, then the list shows one row "Food · $12.50" and the header total shows $12.50.
- **AC-2** (R2) — Given an expense of 12.50 in Food, when the user edits it to 20.00 in Transport and saves, then the row shows "Transport · $20.00" and the total shows $20.00.
- **AC-3** (R3) — Given one expense, when the user swipes to delete and confirms, then the list shows the empty state and the total shows $0.00.
- **AC-4** (R6, R7) — Given a budget of $100 and expenses totalling $90, when the user adds $20, then the Summary tab shows "Over budget by $10.00" and the tab shows a "!" badge.
- **AC-5** (R5) — Given expenses of $30 Food and $10 Transport this month, when the user opens Summary, then the chart legend shows Food 75% ($30.00) and Transport 25% ($10.00).
- **AC-6** (R9) — Given 3 expenses in August, when the user exports August, then the shared file is named `PocketLedger-2026-08.csv`, has the header `date,category,amount,note`, and 3 data rows with notes containing commas correctly quoted.
- **AC-7** (R8) — Given the app is running, when network traffic is inspected during all flows, then no network requests are made, and the app's entitlements include no iCloud or network capabilities.
- **AC-8** (R1) — Given the add sheet, when the user enters 0 as the amount, then Save stays disabled and "Enter an amount greater than 0." is shown.

## 12. Assumptions & open questions
- Assumption: currency and number formatting follow the device locale; no currency is stored per expense.
- Assumption: "month" means the calendar month in the device's current calendar and time zone.
- Assumption: categories are fixed to the five defaults in v1.
- Assumption: CSV amounts are written as plain decimals with a dot separator (e.g. `12.50`) for spreadsheet compatibility, dates as ISO `YYYY-MM-DD`.
- Open questions: none blocking.
