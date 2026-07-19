# ADR-004 — Saved meal edits never prompt; templates change only via a dedicated screen

**Status:** Accepted

## Decision
Editing a logged instance of a saved meal always forks silently — it never
touches the template, and never asks "edit once or update saved meal?".
Editing the template itself only happens through `save-meal-template`,
reached via a dedicated "Manage Saved Meals" screen.

## Why
A runtime prompt on every edit violates Principle 1 (remove friction) from
`01-executive-summary.md`. The fork-by-default behavior needs no decision
from the user in the moment they're just fixing today's breakfast.

## Consequence
`edit-meal` never writes to `saved_meals`/`saved_meal_items` under any
circumstance. `save-meal-template` is the only function permitted to write to
those tables (outside of initial creation from a logged meal).
