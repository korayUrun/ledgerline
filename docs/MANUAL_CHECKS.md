# Manual checks

What the automated tests cannot see: the redesigned web app in a real browser, and the
flows that were only checked with screenshots (no form was submitted). Go through it once
after the final review (PRs #53–#73); tick each line or note what broke.

## Setup

```bash
docker compose up -d
API_PORT=3002 API_URL=http://localhost:3002 LLM_CLIENT=fake pnpm dev
# only for section 6 (paying), in a second terminal:
stripe listen --events transfer.created,transfer.reversed --forward-to localhost:3002/payments/webhook
```

Sample ticket sales CSV (save as `sales.csv`):

```csv
tier,qty_sold,comps,price,tax,fees
GA,320,25,35.00,560.00,224.00
VIP,70,10,80.00,280.00,112.00
```

Check each page in light **and** dark (the OS setting), and once at phone width (narrow the
window to about 390 px).

## 1. Login

- [ ] Logged out, `/login` shows the green panel, the moving background and the "Example" worksheet card; the right side is not empty.
- [ ] No "Test mode" label anywhere; no "A local demo…" note at the bottom.
- [ ] With "Reduce motion" on (macOS: Accessibility → Display), the page is still.
- [ ] A wrong password shows an error; the demo account logs in.
- [ ] Opening `/login` while logged in goes to `/shows`.
- [ ] The dev-only "N" badge is bottom-right, not over Log out.

## 2. Shell and navigation

- [ ] Sidebar: Workspace (Shows, Artists, Venues), Developers (API keys), Help (Guide); the current page is highlighted.
- [ ] Phone width: the Menu button opens the same links, and the menu closes after you tap one.
- [ ] Tab through a page with the keyboard: every focused control has a visible outline.

## 3. Shows dashboard

- [ ] The four cards count correctly, and clicking one filters the list.
- [ ] Search `harbor` filters by show, artist and venue; "Clear filters" resets.
- [ ] Status chips filter; changing Sort and pressing **Apply** re-sorts.
- [ ] `/shows?q=zzz` shows the "no match" empty state.
- [ ] **New show** opens the panel; create a show for "Stripe Test Band". Note whether the panel stays open afterwards (known possible quirk).
- [ ] Adding a venue or an artist from the panel works (it returns to `/shows`).

## 4. A new show, step by step

On the show you just created. After **every** action, check that the stepper and the
status badge update **without a reload** (bug fixed in #68).

- [ ] Stepper shows "Step 1 of 4 · 0 done"; the "What to do now" card says to import sales.
- [ ] **Import sales CSV** with `sales.csv`: step 1 becomes "Done".
- [ ] Add two expenses; leave one **pending**.
- [ ] Contract: upload any PDF (e.g. `packages/evals/dataset/c03/contract.pdf`). With `LLM_CLIENT=fake` the extraction comes back empty; type the terms on the review page and **Confirm**. Step 2 and 3 become "Done".
- [ ] Settlement: **Compute**. The card says to decide the pending expense; "Submit for review" is disabled with the reason under it.
- [ ] Decide the expense on the Sales tab: the settlement turns **Stale**, the payout figure is grey with "Outdated".
- [ ] **Recompute**, then **Submit for review**.
- [ ] Worksheet: tax and fee lines cite "GA: tax $560.00" etc.; "Payment details" is collapsed.
- [ ] Phone width: worksheet lines show their clause and sources under the label, no sideways scroll.
- [ ] Every action button shows "Computing…", "Submitting…" etc. while it runs.

## 5. Approval guard

- [ ] In review, **Approve and pay** does nothing until the "I have checked the worksheet…" box is ticked.
- [ ] (Optional, through the API or the MCP server) flag an expense while in review: approval is refused with "assistant flag(s) are still open" (#54).

## 6. Paying (needs `stripe listen`)

- [ ] Tick the box and **Approve and pay**: status goes paying → paid (the webhook confirms it).
- [ ] Every tab of the paid show is read-only: no forms, "Locked" in the stepper, a calm "inputs are locked" card.
- [ ] The confirmed contract shows "Confirmed as terms v1 by …" instead of a form.

## 7. Errors

- [ ] Static Bloom → Contract → open its review page: a calm "Something went wrong" card (old local data, see #66), and **Try again** retries.

## 8. Artists, Venues, Guide

- [ ] `/artists`: show counts, latest show, "✓ Stripe account linked" for Stripe Test Band, "○ Not connected" for others; search works.
- [ ] `/venues`: same, with search.
- [ ] `/guide`: four steps, eight statuses, FAQ; linked from the "What to do now" card.

## 9. API keys

- [ ] Create a key: the full key appears **once** in the callout; **Copy** copies it (paste it somewhere to check); **Done** hides it; a reload never shows it again.
- [ ] The table shows the key masked (`ll_<prefix>_••••••••`), "Never" as last use.
- [ ] Copy the curl example, put the key in it, run it: it returns your shows. "Last used" then says "just now" / "x minutes ago".
- [ ] **Revoke** opens a confirmation; Escape closes it; confirming revokes and the row turns muted.
- [ ] The same curl now answers 401.

## 10. Assistant

With `LLM_CLIENT=fake` every answer says the assistant is offline (free). For real answers,
start `pnpm dev` **without** `LLM_CLIENT=fake` (uses `ANTHROPIC_API_KEY` from `.env`, Haiku,
about 1 cent per question).

- [ ] Sidebar → **Assistant**: the suggestion chips use real show names; a chip only fills the box, it does not send.
- [ ] Ask "Which shows need action?": the answer streams, "How I found this" shows `list_shows`, and the question appears under Recent questions.
- [ ] Ask about one show by name: the answer names its step ("Step 2 of 4: Contract") and the next action, matching the stepper on that show's page.
- [ ] Ask it to approve or pay something: it says it cannot, and where a person does it.
- [ ] A show page's "Ask the assistant about this show" link fills the question without sending it.
- [ ] Clicking a recent question replays it with its steps.
