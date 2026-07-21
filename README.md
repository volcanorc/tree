# Celestial Lineage Archive

A responsive, data-driven family and pet lineage website built with React, TypeScript, and Vite. It is designed for the GitHub Pages project URL:

`https://volcanorc.github.io/tree/`

## What is included

- A pannable family map with mouse-wheel zoom, mobile pinch zoom, circular portraits, and SVG relationship connectors.
- The protected Father, Mother, and seven core siblings in youngest-left / eldest-right order.
- Twelve editable grandchildren with the seeded distribution `4 / 2 / 2 / 2 / 2 / 0 / 0`.
- Multiple partner unions with children assigned to the correct partnership.
- An independent pet archive with the protected Iring Brown founder, chronological birth-year rows, optional human owners, pet partners, and offspring.
- Hover detail cards, portrait-anchored profile callouts, multiple safe story links, conditional death dates, missing-value fallbacks, and calculated ages.
- A session-only local admin dashboard with validation, live preview, import, copy, download, reset, and draft recovery.
- Automated GitHub Pages deployment through GitHub Actions.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173/tree/`.

Quality checks:

```bash
pnpm lint
pnpm test
pnpm build
```

## Update the public archive

1. Open `#dashboard` on the site and log in as `admin`.
2. Edit the people, families, pets, or archive settings. Changes are stored only as a browser draft.
3. Resolve any validation issues, then choose **Download JSON**.
4. Replace [`public/tree-data.json`](public/tree-data.json) with the downloaded file.
5. Add positive-number PNG portraits under `public/portraits/` for people or `public/portraits/pets/` for pets. Father is person portrait `1`, Mother is person portrait `2`, and Iring Brown is pet portrait `1`.
6. Commit and push to `main`. The Pages workflow tests, builds, and republishes the site.

The downloaded file is a complete replacement, not a partial patch.

## Data and privacy

`public/tree-data.json` contains the complete version-6 public archive:

- `site`: title, subtitle, theme, and the local dashboard credential hash.
- `people`: stable IDs, permanent portrait numbers, public details, life status, optional death dates, a `links` array, and protection state.
- `families`: one or two parent IDs plus ordered child relationships.
- `pets`: pet details, flexible birth dates, optional death dates, independent permanent portrait numbers, a `links` array, and optional human owner IDs.
- `petFamilies`: one or two pet parents plus ordered offspring relationships.

All repository data, images, dates, and links are publicly readable. The PIN only hides editing controls from casual visitors; it does not provide confidentiality or real authorization. Commit only details and portraits that are appropriate for a public website.

People and pets have independent portrait-number namespaces. Automatic paths are `portraits/{number}.png` for people and `portraits/pets/{number}.png` for pets. Only repository-relative PNG paths and explicit HTTPS PNG URLs are accepted; JPG, JPEG, and WebP portraits are rejected. Missing PNG files are valid and display the silhouette fallback. Images are center-cropped, never stretched, and each non-empty story link must use HTTP or HTTPS.

Version-1 through version-5 files, imports, and browser drafts are migrated when loaded. Exported and downloaded files always use version 6. Legacy `ageOverride` values are removed because age is now always calculated. Each person also has an editable `lineageSurname` used by the Family-line highlight filter.

People birth and death dates use exact `YYYY-MM-DD` values. Pet birth and death dates accept two- or four-digit years with optional month and day values, including numeric months, month names, abbreviations, and unambiguous close misspellings such as `12-decamber-9`. Two-digit years expand into the 2000s, and valid pet dates normalize on blur to readable values such as `2012-dec-9`. Ambiguous month fragments remain invalid. Public profile cards display natural dates such as `December 9 2020`, `December 2020`, or `2020`. The read-only age uses the visitor's local date and refreshes at local midnight. A death date freezes age at that date; a Dead record without one continues aging against today. An empty Death date editor pulses until it receives focus and is cleared when a record changes back to Alive. Newly created people and pets also highlight their unfinished guide fields until each field receives focus during the current dashboard session.

Selecting any portrait toggles a profile callout anchored to that portrait inside the graph. Portraits never navigate directly; safe URLs appear as numbered `Visit` buttons in the callout. The selected callout persists while the map pans or zooms, while hovering another portrait can still show its quick details.

## Ordering rules

Children are stored as `{ "personId": "…", "birthOrder": 1 }`. The graph sorts by descending `birthOrder`, so the largest number appears farthest left as the youngest. New children receive the next-largest number automatically.

The Pets graph is chronological: the oldest known birth year appears at the top, pets from the same year appear side by side, and pets without a known year appear in an **Unknown year** row. Each species has a stable horizontal column, so a growing cat lineage cannot overlap or mix with the dog, bird, or other species columns. Full dates are ordered oldest-first within their year. Pet parent and offspring connectors still come from `petFamilies`; stored pet birth order is retained but does not control vertical placement.

Protected records can be edited but not deleted. Removing one parent retains children under the remaining parent. Removing every parent of a family unit requires confirmation and lists the descendant or offspring branch that will also be removed. Both People and Pets support selecting and deleting multiple non-protected records together.
