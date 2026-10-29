# Image Organizer

An application for managing a photo library: importing, browsing, and organizing photos.

> **Status:** early setup. Nothing has been implemented yet.

## Planned features

- Import photos from local folders or by upload
- Browse the library in a fast thumbnail grid
- Organize photos into albums and tags
- Search and filter by date, metadata (EXIF), and tags
- Detect duplicates

## Project structure

```
.
├── design.md        # UI design system reference (colors, typography, components)
├── .gitignore
├── .dockerignore
└── README.md
```

## Getting started

Setup instructions will go here once the tech stack is chosen.

### Local data

User media and local databases go in directories that are ignored by git and Docker (`data/`, `storage/`, `uploads/`, `media/`, `thumbnails/`, `cache/`). Never commit photos to the repository. In Docker, mount them as volumes.

## Design

Visual design guidelines are in [design.md](design.md).
