# Glossary map

Each plugin keeps its own glossary, a bounded context with its own language.
A term is defined once, in the glossary of the context it belongs to, and the
plugin's README links to it.

| Context      | Glossary                                                           | Covers                                                                                   |
| ------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `autonomous` | [`plugins/autonomous/GLOSSARY.md`](plugins/autonomous/GLOSSARY.md) | The autonomous loop: stages, steps, selection, the label contract, the handoff, sessions |
| `stonks`     | [`plugins/stonks/GLOSSARY.md`](plugins/stonks/GLOSSARY.md)         | Swing-trading bookkeeping: IBKR as the source of truth, its mirrors and the watchlist    |

## Relationships

None today. The two contexts share no term and neither reads the other's
data; `datf-lab` is a staging area with no glossary of its own.
