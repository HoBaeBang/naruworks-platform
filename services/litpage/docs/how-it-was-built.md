# How Litpage was built

Litpage started as an experiment run for a YouTube series: how far can AI coding agents get when they rebuild a
full block-based workspace app (pages, an editor, databases, sharing, AI) in about a day?

## 1. Build

A lead Claude Code session (Claude Opus 5.5) split the work into areas: shell and navigation, editor, pages and
sharing, databases, AI, and a developer platform. It ran 44 subagents over about 21 hours; each owned one area, wrote
its code and kept notes. Playwright end-to-end scripts (`e2e/`) and unit tests in every package were the guardrails
that kept the parallel work from breaking what was already done.

## 2. Open-source release

The first build closely followed an existing block-based workspace product, including its wording and look. Before
publishing, it was reworked into its own product:

- **Name and identity**: Litpage, with its own placeholder mark; identifiers, CSS classes, record names, cookies,
  API paths and RPC method names use our names.
- **Text**: every interface string was reviewed. Sentences and longer labels were rewritten in our own words; short
  standard labels ("Delete", "Duplicate") stayed; all message ids are ours; the Korean UI was translated anew from the
  English.
- **Look**: a new set of design tokens with a palette based on the Tailwind CSS colors, and Lucide icons throughout.
- **Content and data**: pricing tables, integration catalogs, templates, onboarding pages, formula documentation and
  help links that came from that product were removed or rewritten.
- **AI**: connected with your own API key (an OpenAI Responses API compatible endpoint or Anthropic).

Notes, research material and working documents from the build are not part of this repository.

Litpage is a research and demonstration project and is provided as is.
