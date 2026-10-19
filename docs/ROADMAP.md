# Horror Pack roadmap (October 2026)

A plan for two things at once: the survivors / foreman AI, and the quest progression. Written so a
cheaper model can pick any item and implement it without the planning conversation. Each item says
what it is, why, and roughly how hard. "No model" means the feature needs no API call at all in play.

Ground rules that came out of planning:

- **Stay separate from MineColonies.** The players don't trust AI to touch the working colony mod.
  Survivors remain their own entity with their own pathing. The colony bridge stays read-mostly:
  read requests, read build state, hand items to workers through supply chests. Never register
  citizens, jobs or huts of our own.
- **Near-zero API spend in play.** The $100 credit is for developing, not for the server's key.
  Everything the crew does by default must run without a model. The model is for talking, and for
  the foreman when a player explicitly asks it something routines can't answer.
- **Chat is a scarce resource.** Every new line of survivor talk has to earn its place; most flavor
  goes to subtitles/voice, not the chat log.

---

## Part 1 - Why the survivors have been hard, in one paragraph

The brain was never the problem. A "normal player" is thousands of small physical competences
(walk around the hole, don't drown, pillar up, find the door) and each one is hand-written Java.
We have about ten (gather, dig, plant, farm, smelt, guard, sort chest, fetch, small builds). The
model can only pick from that menu, so anything outside it simply can't happen. On top of that the
survivors only *think* when poked: one request, one snapshot of the world, one answer, then dormant.
Real players are always doing something sensible in the background, and that absence is what makes
ours feel like NPCs. The fix is not a smarter model; it is (a) routines that run all the time without
one, and (b) a slowly growing library of saved actions.

---

## Part 2 - Survivors / foreman roadmap

### 2.1 The daily rhythm (no model) - do first
A standing schedule every crew member follows when nobody has given an order:

| In-game time | What they do |
|---|---|
| Dawn | Walk to the supply chest. Read what colony workers are waiting for (bridge already does this every 30 s). Whatever is short and gatherable (logs, cobble, sand, crops) becomes today's job. |
| Day | Work the job in shifts: ~10 min work, short break at the chest, eat if hungry (self-care exists in 0.19). |
| Late afternoon | Head home. One crew member refills torches along the way home (torch placement exists in camp projects). |
| Dusk | Everyone inside the protect radius. One takes watch (`guard` primitive), rotating nightly. |
| Night | Stay put. Chatter budget nearly zero. |

Why: this single change is what makes them feel like teammates instead of NPCs, and it costs no
tokens. A player order always overrides the rhythm; when the order finishes they fall back into it.
Effort: medium. Reuses Tasks, Initiative, SupplyChests, Guard. Cheap-model-ready once the shift
state machine is sketched (Opus for the sketch, then hand off).

### 2.2 Routines before the model (no model for common asks)
When a player speaks to the foreman or crew, try these in order:
1. Exact or fuzzy match against saved skills (`/foreman skills` already exists) and a small built-in
   phrasebook ("chop wood", "get stone", "come here", "stop", "go home", "guard here").
2. Only if nothing matches, call the model.
Save every model-composed plan that succeeded as a named skill (ask the player to name it, or auto-name
from the verb and object). Over weeks the phrasebook grows and the model is called less and less.
Effort: small for the matcher, already-built for the skill store.

### 2.3 Senses as events, not snapshots (no model)
Hook a handful of events and give each a cheap scripted reaction. A spoken line is optional and
rate-limited; the *reaction* is the feature.

| Event | Default reaction |
|---|---|
| Survivor hurt | Back off toward nearest player or home; one short line, cooldown 60 s |
| Player hurt within 16 blocks | Turn toward it, move to the player, draw weapon if they have one |
| Night falls while outside | Start the walk home, buddy rule below |
| Horror mob within range (Kenny, Angel, Dweller, Knocker, infected) | Fear rises fast; stay behind the nearest player; whisper line |
| Build finished / request filled | Carry on, no line (the foreman can summarize later if asked) |

**Rare comedic panic.** A small share of scare events (tuning key, default about 1 in 15) escalate to
a panic: drop what they're holding and run the wrong way, wedge into a one-block hole and refuse to
come out until a player stands next to them, scream one word repeatedly, climb onto a roof, hide
behind a player who is shorter than them. Panic ends on its own after a minute or when a player is
adjacent. Each panic type is one small routine; add them one at a time.
Effort: small each. Cheap-model-ready.

### 2.4 Buddy rule with plot armor (no model)
- After dark nobody goes out alone. A survivor sent out at night first asks the nearest player to
  come; if none is near, it pairs with another crew member. Pairs stay within 6 blocks.
- A pair out in danger **cannot be killed by mobs**. Instead they enter a "slowed" state: limping,
  fear stumbles, lanterns held up, progress at half speed, with scared lines. They always make it
  home eventually.
- Per dangerous night trip there is a 1% chance one of the pair does not make it (a real death,
  with a remark from the other). Never both: the roll happens once per pair, not per survivor.
- Alone and caught out: no plot armor. That's the point of the rule.
Effort: medium. Mostly state and a damage hook.

### 2.5 Trust, forgiving (no model)
One number per survivor, 0-100, visible in their speech tone and how fast they respond.
- Rises quickly: protected when scared, fed, housed, given a lantern, orders that end with them home.
- Falls slowly: left alone outside at night, hurt with a player nearby who did nothing, long neglect.
- Floor at 30: they grumble and dawdle, they never sabotage. Leaving the colony is a last resort
  after days of neglect, with two warnings first, and they can be talked back.
- Higher trust unlocks: longer solo trips by day, offering tips about nearby danger, and stories.
Effort: small. Cheap-model-ready.

### 2.6 Chat budget (no model)
Three channels, in order of cost to players' attention:
1. **Chat** - only things a player must know: a crew member is hurt, a job finished, a direct reply.
2. **Subtitles / action bar** - all flavor, panic lines, chatter. `/foreman subtitles off` hides them.
3. **Voice** - optional (Groq TTS costs money; off by default on the shared key).
Radio chatter from home while players are on a Lost Cities run: at most one line per 10 minutes,
only for events in channel 1, only when every player is more than 200 blocks from the town hall.
Effort: small; mostly routing existing lines.

### 2.7 Dropped
- Alarm chain / shared waypoint pings on sightings. Decided against.
- Registering the crew as MineColonies citizens. Decided against (see ground rules).

### 2.8 Cost controls in the mod (when a model *is* called)
- Prompt caching on the foreman: the context notes and the action list are identical every call;
  mark them cacheable. This is the single biggest saving.
- Sonnet for routine foreman planning; Opus only on "stuck", "why", and multi-step jobs.
- Haiku for dialogue stays; it is already near free.
- Keep `foremanCallsPerDay` low by default and surface it in `/foreman jobs`.

---

## Part 3 - Quest progression: hybrid, story first, never blocked by a side mod

The book already has the right shape: **The Line** (Acts 0-5) is the story; **Field Guides** teach
Create, the Infection, the colony and the horrors. The problems are a few hard gates on the story
line that depend on a side mod or on luck.

### 3.1 Gates that block the story today, and the fix

| Act | Current gate | Problem | Change |
|---|---|---|---|
| 2 Below the Line | "Scavenge the Depot" needs 16 Create track in hand before "The Evacuation Log" | Track is Create-gated unless found in subway loot; a group that skips Create stalls here | Make the track quest optional: "The Evacuation Log" depends only on "Into the Tunnels" and "The Dweller". Track stays as a side quest with its reward. |
| 3 Lights Out | "We Hold" needs all three: walls, "It Spreads" (infection advancement) and killing a Weeping Angel | Angel kill is luck; infection advancement may come late | Set `min_required_dependencies: 2` on "We Hold" so any two of three open it. |
| 4 Other Doors | Four dimensions in a fixed chain (Twilight -> Nether -> Aether -> Undergarden) | Long, harsh, one bad night stalls everyone | "Every Door Leads Back" requires any 2 of the 4 dimension quests. Boss kills become optional side quests. |
| 5 Above | "The End of the Line" needs an airship (Create Aeronautics) and the Moon (Ad Astra) | Both are deep tech chains | Keep it as endgame but require 1 of 2 (airship *or* Moon). |
| 1 The Platform | "District One Is Lit" needs builder hut + residence + lanterns | Fine, the colony *is* the story. Just make sure the hut items are the cheap gate (they are), not the finished buildings. | No change. |

Also check in-game that `progression_mode: "flexible"` behaves the way we think for chapter gates;
if a gate still hides later chapters entirely, switch gates to `optional: true` dependencies instead.

### 3.2 The infection arrives early - meet it early
Infection grows near players and starts fast, while the anti-spore kit lives in the Infection
field guide where a new group won't look.
- **Link "Before It's Too Late" into Act 1** (a quest link in "The Platform") so the early kit
  (gas mask, cryo boots, ice bombs, a C.D.U. at the colony edge) is on the story page.
- **Give the first gas mask as a reward** of "Survive the First Night" and a few ice bombs as a
  reward of "District One Is Lit".
- **Stagger the grace period**: the kubejs grace script blocks all horror spawns for 3 days. Give
  the infection its own, longer grace (suggest day 5, to line up with Kenny starting on day 6) so
  Act 1 can be finished before the fungus shows up. One extra constant and a second prefix list.
- **Spore chapter ordering**: put "Before It's Too Late" and "Breathe Easy" (gas mask) directly
  under "First Contact" at the top of the chapter, and move the deep Mimicry / Reforged tree to the
  bottom so the page reads early-to-late.

### 3.3 The Create line stays a side road with its own payoffs
No story gate depends on it after 3.1. To make it worth walking:
- Reward the first train ("Your Own Train") with something the story wants: a stack of lanterns
  and a chunk loader, framed as "the Builders' gift".
- Let the survivors mod's scavenge loot keep seeding track and andesite alloy in subways so Create
  can be *found* before it is *built*.

### 3.4 Pace check per act (target real-time for a group of 3-5)
- Act 0 Arrival: one evening. Act 1 The Platform: two sessions. Act 2 Below the Line: one or two.
- Act 3 Lights Out: whenever a blood moon lands; the 2-of-3 gate keeps it from dragging.
- Act 4 and 5: open-ended by design.
If any act is taking a group more than double this, loosen its gate before adding content.

---

## Part 4 - Working on this from the cloud (first time with cloud sessions)

- **Put the Survivors source on GitHub.** Only the finished jar lives in this pack, so no cloud
  session can change the mod until the source is pushed. That is the biggest unblock for using the
  credit on real work.
- **One branch per roadmap item.** Name it after the item ("daily-rhythm", "buddy-rule"), point a
  cheap session at this file and the item number, and let it work. Items marked cheap-model-ready
  need no planning conversation.
- **Keep this file and `config/survivors/claude_context.md` current.** They are the handoff between
  sessions; a cloud session starts from a fresh clone and knows nothing else.
- **Opus for sketches, cheap models for the rest.** Use the expensive model to write the state
  machine for 2.1 and to review tricky diffs. Everything else here is implementation against a
  clear spec.
