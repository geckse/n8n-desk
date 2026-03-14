---
description: Applies when working with PRD files in the docs/prds directory
globs: docs/prds/**/*.md
---

# PRD File Rules

- Always follow the structure defined in `docs/prds/base-template.md`
- Use kebab-case for PRD filenames (e.g., `user-authentication.md`, not `userAuthentication.md`)
- Every PRD must be self-contained — assume it will be read in a fresh session with no other context
- Implementation steps must reference specific file paths and be directly actionable
- Validation criteria must be concrete and testable (no vague phrases like "works well" or "looks good")
- Include a clear title, overview, and success metrics in every PRD
