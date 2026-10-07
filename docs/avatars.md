# Avatars

Bringing your own model, what a model needs in order to work, and the licence
on the two that ship with the application.

---

## Bringing your own

**Drop a `.vrm` file anywhere on the page**, or open **Setup** and use *Upload
a VRM avatar*. Either way the model loads immediately and joins the avatar list
under its own group for the rest of the session.

**A dropped file is never uploaded.** It is read locally, in the page, the same
way the camera is. There is no server to send it to.

Dropping is faster once you know about it and invisible until you do, which is
why the file picker exists as well. Dropping has one practical advantage worth
knowing if you are authoring models: it lets you try a model straight out of
wherever you exported it, without the sandbox restrictions a packaged
authoring tool may put on a file picker.

Files are held as handles rather than copies, so keeping a dozen models in the
list this session costs nothing. The trade is that a file you move or delete
afterwards cannot be read again, which surfaces as an ordinary load error
naming the file.

---

## What a model needs

**VRM 1.0** is what to aim for. VRM 0.x loads too, through a compatibility path
that applies a rotation correction, and the loader says so when it takes that
path.

### Bones

The application drives **22 humanoid bones**: hips, spine, chest, upper chest,
neck and head; shoulders, upper arms, lower arms and hands on both sides; upper
legs, lower legs and feet on both sides; and both eyes. Fingers are a further
30 bones on top of that.

**A model missing bones still works.** It degrades rather than failing, but the
two kinds of gap degrade differently, so the loader reports them differently:

- **A missing body bone drops its share of the rotation** rather than
  redistributing it to its neighbours. The avatar then under-rotates, which
  reads as *sluggish* rather than as broken — which is exactly why it is worth
  surfacing. These are named in full.
- **Missing finger bones** are reported in one line. A mitten-handed model has
  none of the thirty, which is an ordinary and harmless kind of model; its
  hands simply stay at rest. Naming all thirty would put five hundred
  characters of bone names in a banner and make an expected outcome read as a
  catastrophe.

Eyes are needed for gaze. Without them the avatar's eyes stay put, and
everything else still works.

### Expressions

The application writes these VRM expression presets by name:

| Preset | Driven by |
|---|---|
| `happy`, `angry`, `sad`, `relaxed`, `surprised` | the expression buttons and number keys |
| `blink` | the blink timer, or the camera when face tracking is on |
| `aa`, `ih`, `ou`, `ee`, `oh` | lip sync |

A model without a given preset loses that feature and nothing else. A model
with no visemes still opens its mouth if it has `aa`.

### Scale

Models are expected to be around human height. A model well outside that still
tracks correctly — tracking is scale-independent — but **spring-bone physics
were tuned at the authored scale**, so hair and clothing on a model that is
half or double the expected height may behave oddly. The loader warns when a
model is far enough out to matter.

---

## Checking a model without opening a browser

```sh
npm run inspect-vrm <path>
```

It parses the glTF container directly, so it needs no browser and no camera:

```
file        : public/models/AvatarSample_X.vrm (7.1 MB)
VRM version : 1.0
humanoid    : 54 bones mapped
spring bones: true
MToon       : true
meshes      : 2, materials: 2
driven 22   : ALL PRESENT
```

If bones are missing it names them and says what that will look like. This is
the fastest way to find out why a model is sluggish, and it is worth running on
any model before you build a scene around it.

## Shrinking a model

```sh
npm run shrink-vrm <in> [out]
```

A VRM carries a **metadata thumbnail** — a preview image for model browsers and
galleries like VRoid Hub. This application never displays it. On a VRoid export
it is a 2048px PNG and routinely the single largest image in the file: measured
at 2.11MB of a 13.49MB model, about 16%, downloaded by every visitor in order
to be ignored.

VRoid will not export without one and its texture floor is 2048px, so stripping
it afterwards is the only way to drop it. `three-vrm` reads the thumbnail behind
a null check, so a model without one loads normally.

**This is for serving, not for archiving.** A stripped model shows no preview in
tools that expect one, so keep your original.

One licence caveat: a VRM whose metadata sets `modification: prohibited` covers
optimising it, and that includes stripping the thumbnail. Check before you run
this on somebody else's model.

---

## The bundled avatars

Two models ship with the application and are what the avatar picker offers out
of the box:

| | |
|---|---|
| **Avatar X** | `AvatarSample_X.vrm`, 7.1MB |
| **Avatar B** | `AvatarSample_B.vrm`, 11.9MB |

Both are **VRoid Studio's own sample models**, authored by **pixiv VRoid
Project**, with their metadata thumbnails stripped.

### What you may do with them

pixiv's published terms are broad: these models **may be used by anyone, in any
activity, commercial or not, with no credit required.** You may stream with
them, monetise the stream, and never mention where they came from.

**Two things are prohibited**, and one of them is easy to do by accident:

- **Do not re-license them as CC0.** Copyright is not waived. Setting the
  redistribution condition to the CC0 disclaimer is specifically called out,
  and the `authors` field must keep naming pixiv.
- **Do not build a character-creation service** from the data in them.

### Why the file's own licence reads more narrowly

Worth knowing, because it looks like a contradiction and cost a round trip to
resolve.

Every VRM carries its licence inside `VRMC_vrm.meta`, and as VRoid ships these
samples those fields read `allowRedistribution: false`, `modification:
prohibited`, `avatarPermission: onlyAuthor` — which reads as "this file may not
be shipped inside anything."

**Those fields are the export dialog's defaults, not a statement of pixiv's
terms**, and it is the author's published terms that govern. The copies here
were exported with the permissions set to match what pixiv already grants,
which is a correction rather than a claim.

A model made in VRoid by its own author is simpler: the author sets those
fields and they mean what they say.

### The fields that matter, on any model

If you are deciding whether a model may be redistributed or deployed, these are
the ones to read:

| Field | `false` / restrictive value means |
|---|---|
| `allowRedistribution` | the file may not be shipped inside anything |
| `modification` | `prohibited` covers optimising it, including stripping the thumbnail |
| `avatarPermission` | `onlyAuthor` means nobody else may use the avatar |
| `commercialUsage` | `personalNonProfit` rules out a monetised stream |
| `creditNotation` | `required` means the author must be named |
