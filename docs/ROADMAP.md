# Horror Pack roadmap: work orders (October 2026)

Written so a cheaper model can take one work order at a time without the planning conversation.
Each order says what to build, where, how to check it for free, and which model and effort to use.

## Read this first

**Two repos.**
- `judsonj/horror-pack-dev` (private): the Survivors mod source (`coremod/`), the pack build scripts
  (`build/`), server configs and notes (`Build State.md`, newest at the bottom). **All code and quest
  work happens here.**
- `judsonj/horror-pack` (public, this repo): the packwiz output players' Prism pulls from. Its
  `config/ftbquests/`, `kubejs/` and `mods/survivors-*.jar` are **generated** by the dev repo's
  `build/make_quests.py`, `build/make_packwiz.py` and friends. Don't hand-edit them; the next build
  overwrites them.

**Build and test, no AI calls needed.**
- Mod: `cd coremod && ./gradlew build` (Java 21; compiles against jars kept in the repo).
  Bump `mod_version` in `coremod/gradle.properties`.
- Local test bench (console, op): `/foreman test setup`, `/foreman test order|skill|status`. These run
  the crew's real task code with no model. `/foreman test ask` spends Opus: don't use it.
- Shipping (DatHost upload, restart, packwiz push, Prism relaunch) needs the operator's PC. A cloud
  session prepares; the operator ships.

**Ground rules from planning.**
- Stay separate from MineColonies. Survivors are their own entity with their own pathing; the colony
  bridge reads requests and fills them through supply chests, nothing more.
- Near-zero API spend in play. The credit is for development, not the server's key. Default crew
  behavior must need no model.
- Chat is scarce. Must-know lines in chat; flavor to the action bar or voice.
- Decided against: alarm chain / waypoint pings on sightings; registering crew as citizens.

**Why the survivors have been hard, in short.** A "normal player" is thousands of small physical
competences and each one is hand-written Java; we have about twenty task kinds. The crew also only
*think* when poked: one request, one world snapshot, one answer, then idle. The fix is routines that
run all the time without a model, plus a saved-skill library that grows. Not a smarter model.

---

## The orders at a glance

| Order | Repo | Size | Model and effort |
|---|---|---|---|
| A. Story gates never block on Create or luck | dev (`build/make_quests.py`) | small | Sonnet, low |
| B. Infection arrives on a schedule the group can meet | dev (quests + `kubejs` grace script) | small | Sonnet, low |
| C. Cut the foreman's background spend | dev (`colony/Foreman.java`, `Guard.java`, `Tuning.java`) | small | Sonnet, medium |
| D. Chat budget | dev (`Notify.java`, `Crew.java`, `Dialogue.java`) | small-medium | Sonnet, medium |
| E. Phrasebook before the model | dev (`colony/Foreman.java`, `Skills.java`) | medium | Sonnet, medium |
| F. Daily rhythm for the crew | dev (new `colony/Rhythm.java`, hooks in `SurvivorEntity`) | large | Opus medium for the design pass, then Sonnet medium to implement |
| G. Senses as events, with rare comedic panic | dev (`entity/Awareness.java`, new `entity/Panic.java`) | medium | Sonnet, medium; each panic routine Haiku or Sonnet low |
| H. Buddy rule with plot armor | dev (`entity/SurvivorEntity.java`, `colony/Crew.java`) | medium | Sonnet, medium |
| I. Trust, forgiving | dev (`entity/SurvivorEntity.java`, `Mind.java`) | small | Sonnet, low |

Effort, for a first-timer: *low* is for data edits and one-file changes with a clear spec; *medium*
for code that touches a few files and has to be reasoned about; *high* only for design. Haiku is fine
for A and the small panic routines in G if a Sonnet session has already laid the groundwork.
Suggested order: A, B, C, D first (an evening of cheap sessions, all shippable together), then F
(the one that changes how the crew feels), then E, G, H, I in any order.

---

## A. Story gates never block on Create or luck

The book is already a hybrid: **The Line** (Acts 0-5) is the story, the **Field Guides** teach Create,
the Infection, the colony and the horrors. Four story gates still depend on a side mod or on luck.

| Act | Today | Change |
|---|---|---|
| 2 Below the Line | "The Evacuation Log" needs "Scavenge the Depot" (16 Create track in hand) | Drop that dependency: the gate depends only on "Into the Tunnels" and "The Dweller". Track stays as a side quest with its reward. |
| 3 Lights Out | "We Hold" needs walls, "It Spreads" (infection advancement) and killing a Weeping Angel | `min_required_dependencies: 2` on "We Hold". |
| 4 Other Doors | "Every Door Leads Back" needs Twilight, Nether, Aether and Undergarden in a chain | Depend on all four dimension quests with `min_required_dependencies: 2`; boss kills stay optional side quests. |
| 5 Above | "The End of the Line" needs an airship and the Moon | `min_required_dependencies: 1`. |

Leave Act 1 alone: the colony *is* the story and its gate is cheap (owning hut items, not finished buildings).
Where: whatever in `build/make_quests.py` emits those quests. Check: regenerate, open the book in a
local client, confirm the gates read as above and `progression_mode: "flexible"` still shows later
chapters. If a gate hides the next chapter outright, switch that dependency to `optional: true`.

## B. Infection arrives on a schedule the group can meet

The fungus grows near players almost at once, while the anti-spore kit lives in the Infection guide.
1. Quest link "Before It's Too Late" onto the Act 1 page ("The Platform") so the early kit is visible
   on the story page.
2. Rewards: a gas mask on "Survive the First Night"; four ice bombs on "District One Is Lit".
3. Spore chapter order: "Before It's Too Late" and "Breathe Easy" directly under "First Contact"; the
   Mimicry / Reforged tree at the bottom.
4. Grace: the kubejs grace script blocks all horror spawns for 3 in-game days with one constant.
   Give the infection prefixes (`spore:`, `sporeinquisition:`, `infnexus:`) their own constant at 5
   days, lining up with Kenny on day 6. Everything else stays at 3.
Where: `build/make_quests.py`; the grace script's source under `build/` (find the file that produces
`kubejs/server_scripts/horror_grace.js`). Check: fresh local world, `/time add` through day 4, no
spore mobs; day 5, they can spawn.

## C. Cut the foreman's background spend

Today: `foremanDailyCalls` defaults to 400; the colony watch (every 90 s) spends an Opus turn per new
situation; nothing is cached.
1. Prompt caching: mark the static part of the foreman request (system prompt with the context notes
   and the tool list) as cacheable. Same for the Haiku dialogue system prompt. This is the biggest
   saving for the calls that remain.
2. Colony watch without a model for the known situations: no supply chest, no builder, unclaimed work
   orders, items waiting on players. Each becomes a fixed one-line notice to the mayor (action bar,
   once per situation per hour). Only an *unknown* situation may spend a model turn.
3. `foremanDailyCalls` default 400 -> 40. `/foreman usage` keeps showing tokens.
4. Foreman model: Sonnet for ordinary asks; Opus only when the request contains "why", "stuck", or
   starts a multi-step job. One constant and a chooser.
Check: `/foreman test status` on the bench shows notices without a call; `/foreman usage` after a
bench session reads zero.

## D. Chat budget

Three channels. **Chat**: a crew member hurt, a job finished or failed, a direct reply. **Action bar /
subtitles**: everything else (panic lines, chatter, "for materials" steps; `/foreman subtitles off`
hides them). **Voice**: optional, off on the shared key.
- The chorus stays one combined chat line but names the speakers (already in 0.19).
- Radio chatter from home while players are away: at most one chat line per 10 minutes, channel-1
  events only, only when every player is more than 200 blocks from the town hall.
- Haiku replies: keep `replyMaxChars` 130 and the first-sentence cut.
Where: wherever `Notify`, `Crew.ended`, `Crew.distress` and `Dialogue` choose chat vs action bar.
Check: bench session, count chat lines per crew task; the target is one per finished order.

## E. Phrasebook before the model

When a player speaks to the foreman or a crew member, try in order:
1. Saved skills (`Skills.java`, `config/survivors/skills.json`): exact name, then a fuzzy match on the
   verb and object.
2. A built-in phrasebook, about twenty entries: "chop wood", "get stone", "come here", "follow me",
   "stop", "go home", "guard here", "light this up", "plant trees", "farm", "sort the chest".
   Each maps straight to a `Tasks.Task`.
3. Only then the model. Every model plan that finishes without failure is offered as a new skill
   ("saved as 'fence the east side'; say that next time").
Check: bench, `/foreman test order "chop wood"` resolves with no call; `/foreman usage` unchanged.

## F. Daily rhythm for the crew

The big one. Settled survivors already have `Camp.plan` (evening torches, camp projects, idle chores)
and a morning report; **crew have none of it** by design. Give crew their own rhythm in a new
`colony/Rhythm.java`, driven by in-game time, that only runs when the task list is empty and no order
is active. A player's order always wins; when it ends they fall back in.

| In-game time | Behavior |
|---|---|
| Dawn | Walk to the supply chest. Read what colony workers are waiting on (the bridge already lists requests). Whatever is short and gatherable (logs, cobble, sand, crops, saplings) becomes today's job. |
| Day | Work in shifts: about 10 minutes of the job, a short break at the chest, eat if hungry (self-care exists). |
| Late afternoon | Head home. One member refills torches on dark spots inside the protect radius on the way (reuse `Camp.darkSpots`). |
| Dusk | Everyone inside the protect radius. One takes watch with the `GUARD` kind, rotating nightly. |
| Night | Stay put; nothing leaves camp (see H for the exception). |

Design pass (Opus, medium): the shift state machine, how "short" is computed from requests plus chest
contents, how the rotation is stored (SavedData next to growth), and how an order interrupts and
resumes. Output: a half-page spec and method stubs. Implementation (Sonnet, medium) fills them in.
Check: bench with a founded Testville and a marked chest, `/time set` through a day: the log shows
the dawn read, a gather, the torch pass, a guard at dusk, and no model calls.

## G. Senses as events, with rare comedic panic

`Awareness` builds a text snapshot for the model. Add event hooks with scripted reactions; a spoken
line is optional and rate-limited, the reaction is the feature.

| Event | Reaction |
|---|---|
| Survivor hurt | Back toward the nearest player or home; one short line, 60 s cooldown |
| Player hurt within 16 blocks | Face it, move to the player, draw a weapon if carried |
| Night falls while outside | Start home (H decides the pairing) |
| Horror mob within range (Kenny, Angel, Dweller, Knocker, infected) | Fear rises fast; stay behind the nearest player; whispered line |

**Rare comedic panic** (`entity/Panic.java`): a tuning key `panicChance`, default about 1 in 15 scare
events, escalates to one of: drop what they hold and run the wrong way; wedge into a one-block hole
and refuse to come out until a player stands next to them; scream one word on repeat; climb onto the
nearest roof; hide behind a player who is shorter. Ends after a minute or when a player is adjacent.
Each panic is one small routine; add them one at a time, each its own cheap session.
Check: bench, spawn a zombie near a crew member, watch fear and the reaction; set `panicChance 1` to
force a panic.

## H. Buddy rule with plot armor

- After dark nobody goes out alone. A survivor sent out at night first asks the nearest player to
  come; if none is within 24 blocks, it pairs with another crew member. Pairs stay within 6 blocks.
- A pair out in danger cannot be killed by mobs: damage that would kill is cancelled and they enter a
  "slowed" state (half speed, stumbles, lantern held up, scared lines). They always make it home.
- Per dangerous night trip, one roll per pair: 1% that one of the two does not make it (a real death
  with a remark from the other). Never both.
- Alone and caught out: no plot armor. That is the point of the rule.
Where: a damage hook in `SurvivorEntity`, pairing in `Crew`, the trip state on the entity (saved).
Check: bench at night, order one member out: watch the pairing; set the roll to 100% once to see the
single-death path, then back to 1%.

## I. Trust, forgiving

One number per survivor, 0-100, saved with the entity and shown through tone and response speed.
- Rises quickly: protected when scared, fed, housed, handed a lantern, orders that end with them home.
- Falls slowly: left out alone at night, hurt with a player near who did nothing, days of neglect.
- Floor at 30: grumbling and dawdling, never sabotage. Leaving is a last resort after days of neglect,
  with two warnings first, and they can be talked back.
- Higher trust: longer solo trips by day, tips about nearby danger, stories.
Check: bench, watch the number via the name-tag inspect line (`/claude` style) as you feed and protect.

---

## Working on this from the cloud

- In a cloud session, attach the private dev repo first (ask Claude to add `judsonj/horror-pack-dev`).
  Without it a cloud session can only see this public output and can't change the mod or the quests.
- One branch per order, named for it ("daily-rhythm", "chat-budget"). Point the session at this file
  and the order letter. Keep `Build State.md` in the dev repo and `config/survivors/claude_context.md`
  current; they are the handoff between sessions.
- If the cloud environment's network policy blocks Gradle's dependency downloads, the build can't run
  there: do the edit in the cloud, compile on the operator's PC.
- Rough spend on the credit: an order marked small at Sonnet low or medium is a few dollars of session
  time; F's Opus design pass is the one that costs real money, and it is one pass.
