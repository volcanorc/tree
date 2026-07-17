# Celestial Lineage Family Archive

A responsive, data-driven family and pet lineage website built with React, TypeScript, and Vite. It is designed for the GitHub Pages project URL:

`https://volcanorc.github.io/tree/`

## What is included

- A pannable family map with mouse-wheel zoom, mobile pinch zoom, circular portraits, and SVG relationship connectors.
- The protected Father, Mother, and seven core siblings in youngest-left / eldest-right order.
- Twelve editable grandchildren with the seeded distribution `4 / 2 / 2 / 2 / 2 / 0 / 0`.
- Multiple partner unions with children assigned to the correct partnership.
- An independent pet archive with the protected Iring Brown founder, optional human owners, pet partners, and offspring.
- Hover detail cards, touch detail panels, safe story links, missing-value fallbacks, and calculated ages.
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
5. Add numbered portrait images under `public/portraits/`. Father is `1`, Mother is `2`, and the permanent number is shown in each dashboard record and hover card.
6. Commit and push to `main`. The Pages workflow tests, builds, and republishes the site.

The downloaded file is a complete replacement, not a partial patch.

## Data and privacy

`public/tree-data.json` contains the complete public archive:

- `site`: title, subtitle, theme, and the local dashboard credential hash.
- `people`: stable IDs, permanent portrait numbers, public details, life status, links, and protection state.
- `families`: one or two parent IDs plus ordered child relationships.
- `pets`: pet details and optional human owner IDs.
- `petFamilies`: one or two pet parents plus ordered offspring relationships.

All repository data, images, dates, and links are publicly readable. The PIN only hides editing controls from casual visitors; it does not provide confidentiality or real authorization. Commit only details and portraits that are appropriate for a public website.

When the portrait field is empty, the site tries `public/portraits/{number}.png`, then `.jpg`, `.jpeg`, and `.webp`. A manually entered relative path or HTTPS portrait overrides that numbered lookup. Images are center-cropped, never stretched. External portraits must use HTTPS, and external story links must use HTTP or HTTPS.

## Ordering rules

Children are stored as `{ "personId": "…", "birthOrder": 1 }`. The graph sorts by descending `birthOrder`, so the largest number appears farthest left as the youngest. New children receive the next-largest number automatically.

Protected records can be edited but not deleted. Removing one parent retains children under the remaining parent. Removing every parent of a family unit requires confirmation and lists the descendant branch that will also be removed. The dashboard supports selecting and deleting multiple non-protected records together.
