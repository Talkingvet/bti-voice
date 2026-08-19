# Customer Onboarding Pipeline — Zoho CRM Build Guide

This is the click-by-click build. It's split into three parts:

- **Part A — You:** create the module shell in the Zoho UI (~5 min).
- **Hand-off — Me:** I create all the custom fields via the connector (no work for you).
- **Part B — You:** build the Blueprint, Kanban, and automations in the UI (~15 min).

Do Part A, tell me it's done, I do the hand-off, then you do Part B. Don't skip ahead — Part B depends on the fields existing.

---

## PART A — Create the module shell (you, in Zoho)

1. Go to **Setup** (the gear icon, top right) → under **Customization** click **Modules and Fields**.
2. Click **+ New Module** (top right).
3. **Module Name:** type `Customer Onboarding`. (Zoho will auto-set the singular label to "Customer Onboarding" — that's fine.)
4. Leave the default single section/layout as-is for now. You'll see one default field called **"Customer Onboarding Name"** — we'll use that as the practice name. Leave it.
5. Click **Save**.

That's it for Part A. **Come back and tell me "module created"** and I'll create all the fields.

> Note: do NOT use the leftover CustomModule5003/5004 — a clean named module is cleaner and avoids confusion.

---

## HAND-OFF — I create the fields (me, via connector)

Once the module exists, I'll create these fields automatically. Here's exactly what's going in so you can verify after:

**Identity / ownership**
- Primary Doctor — *Lookup → Contacts*
- Practice Manager — *Lookup → Contacts* (your discovery-call counterpart)
- Account — *Lookup → Accounts*
- (Record Owner is built in — no field needed)

**The two falloff-killers (will be pinned to the Kanban card)**
- Current Blocker — *Single line text*
- Next Action — *Single line text*
- Next Action Due — *Date*

**Integration assessment**
- PIMS Software — *Pick list* (values: Cornerstone, Avimark, ezyVet, ImproMed/Covetrus, Vetspire, Pulse, Shepherd, DaySmart/Vetter, Hippo, Provet Cloud, Other, Unknown)
- PIMS Supported — *Pick list* (values: Yes, No, Needs Build)
- Complexity — *Pick list* (values: Standard, Complex, New PIMS)
- Discovery Calls Held — *Number*
- Integration Notes — *Multi-line text*

**Money**
- Payment Entered Date — *Date*
- Payment Captured — *Pick list* (values: No, Yes)
- Amount — *Currency*

**Off-ramp reasons**
- Hold Reason — *Single line text*
- Hold Follow-up Date — *Date*
- Lost / Refund Reason — *Single line text*

**Stage** — this is the field the Blueprint runs on:
- Stage — *Pick list* (values, in order: Payment Entered, Discovery Scheduled, Discovery In Progress, Integration Build, Integration Confirmed, Onboarding Scheduled, Live, On Hold, Lost / Refunded)

I'll confirm when these are in. Then do Part B.

---

## PART B — Blueprint, Kanban & automations (you, in Zoho)

### B1. Build the Blueprint (the process enforcer)

1. **Setup → Automation → Blueprint → + Create Blueprint.**
2. **Module:** Customer Onboarding. **Layout:** Standard. **Field:** Stage. Name it `Onboarding Process`. Click **Next** — you're now in the visual builder.
3. You'll see your Stage values as nodes ("States"). Draw transitions by dragging from one state to the next, in this order, naming each transition as shown:

   | From | Transition button | To |
   |------|-------------------|-----|
   | Payment Entered | "Schedule Discovery" | Discovery Scheduled |
   | Discovery Scheduled | "Start Discovery" | Discovery In Progress |
   | Discovery In Progress | "Send to Integration" | Integration Build |
   | Integration Build | "Confirm Integration" | Integration Confirmed |
   | Integration Confirmed | "Schedule Onboarding" | Onboarding Scheduled |
   | Onboarding Scheduled | "Mark Live" | Live |

4. For each transition, click it and set **"During" required fields** (this is the enforcement):

   - **Schedule Discovery** → require *Practice Manager*, *Next Action Due*.
   - **Start Discovery** → require *Discovery Calls Held*.
   - **Send to Integration** → require *PIMS Software*, *PIMS Supported*, *Complexity*. (Add a Criteria so this is only allowed when PIMS Supported = Yes or Needs Build.)
   - **Confirm Integration** → require *Integration Notes*. Add a checkbox/confirmation prompt "Integration tested working?".
   - **Schedule Onboarding** → require *Payment Captured = Yes* (set as criteria) and *Next Action Due*.
   - **Mark Live** → require *Went Live* date (or just confirm).

5. Add two **common transitions** available from every state:
   - "Put On Hold" → On Hold, requiring *Hold Reason* + *Hold Follow-up Date*.
   - "Mark Lost / Refunded" → Lost / Refunded, requiring *Lost / Refund Reason*.

6. **Save and activate** the Blueprint.

### B2. Set up the Kanban board (the team's daily view)

1. Open the **Customer Onboarding** module (top tab; if hidden, find it under the **…** more-tabs menu).
2. Switch the view type (top right, list/Kanban toggle) to **Kanban**.
3. **Group by:** Stage. This gives you a column per stage.
4. Click the Kanban settings (gear on the Kanban view) and set the **fields shown on each card** to: Record Owner, Current Blocker, Next Action, Next Action Due. This is what makes status glanceable.
5. Save it as a view named **"Onboarding Board"** and make it the default for the module.

### B3. Automations — catch the falloff automatically

**Workflow 1 — Stale deal alert (3 days):**
1. **Setup → Automation → Workflow Rules → + Create Rule.** Module: Customer Onboarding.
2. **Execute on:** a **Date/Time**-based trigger using *Modified Time* — set it to run **3 days after Modified Time**.
3. **Criteria:** Stage is none of (Live, Lost / Refunded, On Hold).
4. **Action:** Email notification (or in-app) to **Record Owner**: "This onboarding hasn't moved in 3 days — what's the blocker?" Save and activate.

**Workflow 2 — Missing next action:**
1. New rule, same module. **Execute on:** record create or edit.
2. **Criteria:** Next Action is empty AND Stage is none of (Live, Lost / Refunded).
3. **Action:** notify Record Owner to set a next action. Save.

**Workflow 3 — Integration-confirmed nudge:**
1. New rule. **Execute on:** edit, when **Stage changes to Integration Confirmed**.
2. **Action:** create a Task for the Record Owner: "Capture payment + book onboarding call." Save.

**Workflow 4 — Payment guardrail:**
1. **Setup → Customization → Modules and Fields → Customer Onboarding → Validation Rules → + New.**
2. Rule: if *Payment Captured = Yes* but *Stage* is before Integration Confirmed → show error "Integration must be confirmed before capturing payment." Save.

### B4. Bookings sync (optional, do after the above works)

Your Zoho Bookings calls land in the CalendarBookings module. Once the core pipeline is running, we can add a workflow/flow so completed discovery and onboarding bookings auto-stamp the matching dates on the onboarding record. Tell me when you're ready and I'll spec it.

---

## Suggested owners (from your team)

- **Discovery / appointment setting:** Raven Almendras (Appointment Setter)
- **Discovery + onboarding calls:** Danny Roche (Head of Business Development)
- **Integration build/confirm:** assign to whoever owns integrations (Shawn / Warren / Ryan / Lester)
- **Oversight / board access:** Paul (CEO)

Adjust as you see fit — owners are set per record.

---

## What's left after Part B

- I populate any existing in-flight customers into the board so you start with a live picture (give me the list or point me to where they are).
- We wire the Bookings sync (B4).
- Optional: a live status artifact you can open each morning that reads straight from this module.
