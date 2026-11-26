---
title: Templates
nav_order: 5
description: List badge templates and their ids, and create a new template from a JSON file and a PNG.
---

# Badge templates
{: .no_toc }

1. TOC
{:toc}

---

A badge template is what every badge is issued from: its name, image,
description, skills and earning criteria. Each has an id, which `issue`
takes as `--template`.

## Listing templates: `templates`

```bash
credjar templates
credjar templates --state active
credjar templates --name "Intro" --csv
```

| Option | Effect |
|---|---|
| `--state <states>` | Only templates in these states, comma-separated: `active`, `draft`, `archived`. |
| `--name <text>` | Partial match on the template's name. |
| `--json` | Print the full records as JSON. |
| `--csv` | Also write a CSV to `public/data/`. |

Only **active** templates can be issued from. Credly shows them as
"Published". A **draft** can't be issued from until it is published, and an
**archived** template is no longer issued from but still stands behind the
badges already issued from it.

The CSV has the columns `id`, `name`, `state`, `public`, `level`,
`time_to_earn`, `url`, `created_at` and `updated_at`.

## Creating a template: `templates:create`

```bash
credjar templates:create --sandbox \
  --file template.json --image badge.png --dry-run
```

The JSON file describes the template:

```json
{
  "name": "Example badge",
  "description": "Awarded for completing the example course.",
  "state": "active",
  "skills": ["Testing", "Credly API", "Automation"],
  "badge_template_activities": [
    {
      "activity_type": "Course",
      "title": "Complete the example course",
      "activity_url": "https://courses.example.com/example"
    }
  ],
  "global_activity_url": "https://courses.example.com/example",
  "level": "Foundational",
  "type_category": "Learning",
  "time_to_earn": "Hours",
  "cost": "Free",
  "public": false,
  "allow_duplicate_badges": false
}
```

[`examples/badge-template.json`](https://github.com/kallewesterling/credjar/blob/main/examples/badge-template.json)
in the repository shows every field Credjar accepts.

Credly requires:

- a `name`;
- a `description` of 500 characters or fewer;
- at least three distinct `skills`;
- at least one earning criterion in `badge_template_activities`;
- a PNG image of at least 600×600 pixels, given as `--image`, or as
  `image_url` in the file. Not both.

Set `"state": "active"` to issue from the template straight away, or
`"draft"` to finish it in the Credly dashboard first.

### What it checks

1. **The file and image, locally.** Every missing requirement is reported at
   once, and an unknown field is an error, so a misspelt field name can't be
   silently dropped. Nothing is sent until the file passes.
2. **That no template has the same name.** Two templates with one name are
   hard to tell apart, and rerunning after an unclear failure is the usual
   way to get them.
3. **The plan.** With `--dry-run`, the command stops here.
4. **Your confirmation.** You type `sandbox` or `production`. `--yes` skips
   this, for scripts.

After creating it, Credjar reads the template back and compares it with what
it sent, and writes an audit CSV to `public/data/`.

{: .note }
If the create fails with a server error, the template may exist anyway,
because the response can be lost after Credly has acted. Credjar doesn't
retry it. Run `credjar templates --name "…"` before trying again; if the
template is there, step 2 stops the second attempt anyway.
