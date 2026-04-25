# 📊 Sunday Intelligence Report Structure

This document outlines the **Pillar-Based Dispatch** sent every Sunday to the Lead Architect (**Ramanathan S**) via Telegram.

## 1. 🛡️ Auditor Presence (Bot Health)
- **Satisfied (👍)**: Count of positive, grounded interactions.
- **Intelligence Gaps**: Count of "Information Missing" triggers (Mapping Gaps).
- **Failed Interactions (👎)**: Count of user-flagged errors or unwanted responses.

## 2. 🏛️ Intelligence Feed (Data Growth)
- **New Entities Indexed**: A visible list in the Markdown summary showing the last 10 faculty members, student innovators, or departmental data re-indexed that week.

## 3. 💬 Interaction Feed (Search Intent Audit)
- **Top Queries & Intent**: The **Actual Raw Text** of user queries is displayed in the report overview.
- **Status Mapping**: Queries are tagged as ✅ (Success) or 🔴 (Failure) to allow for instant visual auditing.
- **Critical Failure Audit**: Specific queries that triggered an "Unwanted" reaction are highlighted with the user's specific reason for the dislike.

## 4. 📈 Interaction Vitality
- **Total Weekly Volume**: The total count of all conversational turns processed during the week for scaling and analytics.

## 5. 📂 Deep Audit Log (CSV Attachment)
A comprehensive `Audit_Detailed_[Date].csv` is attached for deeper manual review:
- **Reaction**: The type of feedback (👍/👎/💩).
- **Query**: The full raw user input.
- **Response**: The complete grounded response provided by Lorin.
- **Date**: Precision timestamp of the turn.

---
**Protocol:** This report is dispatched every Sunday at midnight server time via the `scripts/sunday-intelligence.ts` pipeline.
