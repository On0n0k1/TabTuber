# Choosing an avatar

Use one of the two that come with it, or bring your own.

---

## The two that come with it

Open **Setup** — the leftmost toolbar icon — and pick from the **Avatar** list.
**Avatar X** and **Avatar B** are both there, and switching is instant.

Both are VRoid Studio's sample models. **You can stream with them, including
commercially, without crediting anyone.** Two things you may not do, covered at
the [bottom of this page](#the-licence-on-the-bundled-avatars).

## Bringing your own

Two ways, and they do the same thing:

- **Drag a `.vrm` file anywhere onto the page.** Fastest once you know.
- **Setup → Upload a VRM avatar.**

Your model loads immediately and joins the Avatar list, so you can switch back
and forth for the rest of the session.

**Your file is never uploaded.** It is read off your disk, in the page. Like
everything else here, there is no server for it to go to.

One thing to know: the app remembers *where* your file is rather than keeping a
copy. So if you move or delete it and then switch back to it later in the
session, you get a load error naming the file. Reload and pick it again.

### Where to get one

Any **VRM** file works. Common sources:

- **[VRoid Studio](https://vroid.com/en/studio)** — free, and makes VRM
  natively. This is the usual answer if you want your own character.
- **[VRoid Hub](https://hub.vroid.com/)** and **[Booth](https://booth.pm/)** —
  models made by other people. Check what the author allows before you stream
  with one.
- **Blender**, with a VRM exporter add-on.

Aim for **VRM 1.0**. Older VRM 0.x files load too, with a correction applied
automatically.

---

## What makes a model work well

Most models just work. If yours does something odd, it is almost always one of
these.

### It needs a full set of bones

The app rotates 22 bones — spine, chest, neck, head, shoulders, arms, hands,
legs and eyes — plus 30 more for fingers.

**A model missing bones still works, it just does less:**

| Missing | What happens |
|---|---|
| finger bones | hands stay in a fixed pose; everything else is normal |
| eye bones | eyes do not move; everything else is normal |
| a body bone | **the avatar under-rotates**, which looks sluggish |

That last one is worth knowing because it does not look like an error — it looks
like the tracking is bad. If your avatar seems to move less than you do, it is
probably a missing bone rather than anything you can fix with a setting.

### It needs expressions, for expressions

The five expression buttons, blinking, and lip sync all use the model's built-in
expression presets. A model without a given one simply loses that feature:

| | |
|---|---|
| happy, angry, sad, relaxed, surprised | the five expression buttons |
| blink | blinking |
| aa, ih, ou, ee, oh | mouth shapes for lip sync |

Models made in VRoid Studio have all of these.

### Roughly human height

Tracking does not care about scale, but the hair and clothing physics were tuned
for a human-sized model. A model that is half or double the normal height may
have oddly floppy or stiff hair. The app warns you when a model is far enough
out for this to show.

---

## Checking a model before you use it

If you have the repository checked out, you can inspect a file without opening a
browser:

```sh
npm run inspect-vrm path/to/model.vrm
```

```
file        : AvatarSample_X.vrm (7.1 MB)
VRM version : 1.0
humanoid    : 54 bones mapped
spring bones: true
MToon       : true
meshes      : 2, materials: 2
driven 22   : ALL PRESENT
```

If bones are missing it names them. This is the quickest way to find out why a
model looks sluggish.

## Making a model load faster

```sh
npm run shrink-vrm path/to/model.vrm
```

Every VRM carries a **preview thumbnail** for model galleries. TabTuber never
shows it, but your viewers' browsers still download it — and on a VRoid export it
is often **15% of the whole file**.

Stripping it makes the model load faster and changes nothing visible. Keep your
original, though: a stripped model shows no preview in tools that expect one.

Do not do this to somebody else's model if its licence prohibits modification.

---

## The licence on the bundled avatars

**Avatar X** and **Avatar B** are VRoid Studio sample models, authored by
**pixiv VRoid Project**.

### What you may do

pixiv's terms are generous. **Anyone may use these models, in any activity,
commercial or not, with no credit required.** Stream with them, monetise the
stream, and you owe nobody a mention.

### What you may not do

Two things, and the first is easy to do by accident:

- **Do not re-license them as CC0.** pixiv has not waived copyright, and the
  author field must keep naming them.
- **Do not build a character-creation service** out of the data in them.

### If the file says otherwise

If you inspect these files you will see licence fields that look much stricter —
no redistribution, no modification, author only. **Those are the export dialog's
defaults rather than pixiv's actual terms**, and it is the published terms that
govern. The copies shipped here have them corrected to match what pixiv already
grants.

### For any other model

If you are using somebody else's model, these are the fields that decide what
you may do with it:

| | Restrictive value means |
|---|---|
| `avatarPermission` | `onlyAuthor` — nobody but the author may use it |
| `commercialUsage` | `personalNonProfit` — no monetised streams |
| `creditNotation` | `required` — you must name the author |
| `allowRedistribution` | `false` — you may not share the file on |
| `modification` | `prohibited` — no editing, including shrinking it |

A model you made yourself in VRoid is simpler: you set those fields, and they
mean what they say.

---

## Next

**[Streaming with OBS →](streaming-with-obs.md)**, or
**[Performing →](performing.md)** to learn the controls.
