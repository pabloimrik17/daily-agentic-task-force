# Slot limits bind only the loop

Every open attempt occupies a slot, whichever command launched it. Only the
loop (`/autonomous:loop`) is refused by the slot limits: when its kind of slot
is full, it launches nothing and waits. A launch a person asks for with
`/autonomous:run` is never refused for capacity, and it still occupies its
slot, so the loop waits until that attempt is finalised or discarded.

## Considered Options

- **Apply the limits to every command.** Rejected: a person who asks for a
  launch has chosen to open that work, and a refusal would make them raise a
  limit to do what they meant to do.
- **Do not count manual launches.** Rejected: the loop would then ignore work
  that is open, and the open attempts could exceed the limits without anyone
  having decided it.

## Consequences

- The limits cap the unattended part only. The loop is the one that must not
  pile up work, because nobody is watching it.
- A person can take the open attempts above a limit on purpose. The loop then
  launches nothing until the count falls below it.
- Slots are derived from the attempt records, so a manual launch needs no
  extra bookkeeping to be counted.
