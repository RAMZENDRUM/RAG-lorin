# 📊 Sunday Intelligence Report Structure

This document outlines the data dispatched every Sunday to the Lead Architect (**Ramanathan S**) via Telegram.

## 1. 🛡️ Infrastructure Status
- **Rate-Limited Users**: Count of unique users who hit the 5/min or 30/day limits.
- **New Entities Indexed**: Count of new faculty, student innovators, or department data added during the week.

## 2. 🗣️ Conversation Performance
- **High Fidelity (👍)**: Total count of user-approved responses.
- **Intelligence Gaps (Hallucination Guard)**: Count of responses where Lorin had to state "I don't have that information."
- **Interaction Failures (👎)**: Total count of responses flagged as "unwanted" by users.

## 3. 🕵️‍♂️ Knowledge Gap Mapping
A list of the top 5 queries that returned "missing info" responses, such as:
- Missing personnel contact details.
- Unindexed department specifics.
- Unrecognized faculty names.

## 4. 🚩 Top Unwanted Responses
Detailed analysis of the top 5 user dislikes, including:
- User's Query.
- User's Feedback (e.g., "duplicate message," "too robotic").
- Lorin's Response for audit.

## 5. 📂 Weekly Audit File (CSV Attachment)
A comprehensive `Weekly_Audit_[Date].csv` containing:
- **Reaction**: The type of feedback (👍/👎/💩).
- **Query**: The raw user input.
- **Response**: The assistant's grounded answer.
- **Date**: Precision timestamp of the interaction.

---
**Protocol:** This report is dispatched every Sunday at midnight server time via the `scripts/sunday-intelligence.ts` pipeline.
