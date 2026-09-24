# Expense Tracker — Implementation Specification

## 1. Overview
A native iPhone app for recording personal expenses, seeing the current month's total and category breakdown, tracking a monthly budget, and exporting a month to CSV. All data stays on the device.

## 2. Scope
In scope: add/edit/delete expenses, monthly total, category chart, monthly budget warning, CSV export.
Out of scope: accounts, cloud sync, multiple currencies, recurring expenses.

## 3. Requirements
- R1: User can add an expense with amount, category, date, and optional note.
- R2: User can edit an expense.
- R3: User can delete an expense.
- R4: App shows the total for the current month.
- R5: App shows a category breakdown chart for the current month.
- R6: User can set a monthly budget.
- R7: App warns the user when the month's total exceeds the budget.
- R8: Data is stored only on the device; no account or cloud.
- R9: User can export a month's expenses as CSV.

## 4. Architecture
SwiftUI views on top of a SwiftData store. Views read expenses with `@Query`. A `BudgetService` compares the monthly total with the budget. A `CSVExporter` builds the CSV file and hands it to the system share sheet.

## 5. Tech stack
Swift 5.10, SwiftUI, SwiftData (iOS 17+), Swift Charts for the chart. No third-party dependencies.

## 6. Data model
- `Expense`: id (UUID), amount (Decimal), category (Category), date (Date), note (String?).
- `Category`: name (String), colorHex (String). Default categories: Food, Transport, Housing, Entertainment, Other.
- Budget: stored as a Decimal in UserDefaults.

## 7. Screens & UX states
- **Expenses tab** — list of this month's expenses, newest first, with the month total at the top. Swipe to delete, tap to edit. "+" button opens the add sheet. If there are no expenses, show "No expenses yet".
- **Add/Edit sheet** — amount, category picker, date picker, note field, Save and Cancel.
- **Summary tab** — month total, budget progress bar, and a pie chart by category. Red banner when over budget.
- **Settings tab** — monthly budget field and "Export this month as CSV" button.

## 8. Implementation plan
1. Create the Xcode project with SwiftData and the tab bar.
2. Add the `Expense` and `Category` models and seed default categories.
3. Build the Expenses tab and Add/Edit sheet.
4. Build the Summary tab with Swift Charts.
5. Add the budget setting and warning.
6. Add CSV export through `ShareLink`.

## 9. Errors & edge cases
Show an alert if saving fails. The amount must be greater than zero.

## 10. Security & privacy
All data is stored locally in SwiftData; nothing is sent over the network.

## 11. Testing & acceptance criteria
Unit tests for `BudgetService` and `CSVExporter` with XCTest.
- AC-1: Given no expenses, when the user adds an expense of 12.50 in Food, then it appears in the list and the month total shows 12.50. (R1, R4)
- AC-2: Given a budget of 100 and expenses totalling 90, when the user adds an expense of 20, then the Summary tab shows the over-budget banner. (R6, R7)
- AC-3: When the user taps Export, a CSV file with one row per expense this month is offered in the share sheet. (R9)

## 12. Assumptions & open questions
- Assumption: currency comes from the device locale.
- Assumption: weeks and months follow the device calendar.
