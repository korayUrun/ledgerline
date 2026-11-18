# Debugging log

Every time something breaks (by accident or in a "Break it" drill), add an entry. Newest first.
Layers are the ones in `docs/SYSTEM.md` §13: extraction → inputs → engine → payment, or web → API → worker → external service.

## Template

### YYYY-MM-DD — short title
- **Symptom:** what I saw (exact command, input, output)
- **Layer:** which layer it lived in, and how I located it
- **Root cause:** the real reason, not the first guess
- **Fix:** what changed (link the commit/PR) and the regression test that now guards it
- **Lesson:** what I'd check first next time

---
