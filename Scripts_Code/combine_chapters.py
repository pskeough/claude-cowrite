#!/usr/bin/env python3
"""
combine_chapters.py — Combine chapter files from a version folder into a single text file.
Run directly: python combine_chapters.py
"""

import os
import re
import sys

BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "BookFiles")


def find_books():
    books = []
    for book in os.listdir(BASE_DIR):
        chapters_dir = os.path.join(BASE_DIR, book, "Chapters")
        if os.path.isdir(chapters_dir):
            books.append(book)
    return sorted(books)


def find_versions(book):
    chapters_dir = os.path.join(BASE_DIR, book, "Chapters")
    return sorted(
        [d for d in os.listdir(chapters_dir) if os.path.isdir(os.path.join(chapters_dir, d))]
    )


def list_chapters(version_dir):
    """Return sorted list of (sort_key, filename) tuples."""
    files = [f for f in os.listdir(version_dir) if f.endswith(".txt")]
    result = []
    for f in files:
        stem = os.path.splitext(f)[0]  # e.g. day_00, day_prologue
        # Extract numeric part for sorting; non-numeric get sorted first
        match = re.search(r"(\d+)$", stem)
        if match:
            key = int(match.group(1))
        else:
            key = -1  # prologue / non-numeric sorts first
        result.append((key, f))
    return sorted(result, key=lambda x: x[0])


def parse_range(input_str, all_keys):
    """
    Parse a chapter selection string like "0-19", "0,5,10-15", "all", or "prologue".
    Returns a set of numeric keys (or -1 for non-numeric like prologue).
    """
    input_str = input_str.strip().lower()
    if input_str == "all":
        return set(all_keys)

    selected = set()
    parts = [p.strip() for p in input_str.split(",")]
    for part in parts:
        if part == "prologue":
            selected.add(-1)
        elif "-" in part:
            bounds = part.split("-")
            if len(bounds) == 2 and bounds[0].isdigit() and bounds[1].isdigit():
                lo, hi = int(bounds[0]), int(bounds[1])
                selected.update(k for k in all_keys if lo <= k <= hi)
            else:
                print(f"  Skipping unrecognized range: '{part}'")
        elif part.isdigit():
            selected.add(int(part))
        else:
            print(f"  Skipping unrecognized token: '{part}'")
    return selected


def main():
    print("=" * 50)
    print("  Chapter Combiner")
    print("=" * 50)

    # --- Select book ---
    books = find_books()
    if not books:
        print("No book folders found under BookFiles/.")
        sys.exit(1)

    if len(books) == 1:
        book = books[0]
        print(f"\nBook: {book}")
    else:
        print("\nAvailable books:")
        for i, b in enumerate(books, 1):
            print(f"  {i}. {b}")
        choice = input("Select book number: ").strip()
        book = books[int(choice) - 1]

    # --- Select version ---
    versions = find_versions(book)
    if not versions:
        print("No version folders found.")
        sys.exit(1)

    print("\nAvailable versions:")
    for i, v in enumerate(versions, 1):
        print(f"  {i}. {v}")
    choice = input("Select version number: ").strip()
    version = versions[int(choice) - 1]

    version_dir = os.path.join(BASE_DIR, book, "Chapters", version)
    chapters = list_chapters(version_dir)

    if not chapters:
        print("No .txt files found in that version folder.")
        sys.exit(1)

    # --- Show available chapters ---
    print(f"\nChapters in {version}:")
    for key, fname in chapters:
        label = "prologue" if key == -1 else str(key)
        print(f"  {label:>8}  →  {fname}")

    all_keys = [k for k, _ in chapters]

    print(
        "\nEnter chapters to include (examples: 'all', '0-19', '0,5,10-15', 'prologue', 'prologue,0-10'):"
    )
    selection_input = input("> ").strip()
    if not selection_input:
        selection_input = "all"

    selected_keys = parse_range(selection_input, all_keys)

    selected_chapters = [(k, f) for k, f in chapters if k in selected_keys]
    if not selected_chapters:
        print("No chapters matched that selection. Exiting.")
        sys.exit(1)

    print(f"\n{len(selected_chapters)} chapter(s) selected.")

    # --- Output filename ---
    raw_dir = os.path.join(BASE_DIR, book, "RawFiles")
    os.makedirs(raw_dir, exist_ok=True)

    default_name = f"{book}_{version}_combined.txt"
    print(f"\nOutput filename (press Enter for '{default_name}'):")
    out_name = input("> ").strip()
    if not out_name:
        out_name = default_name
    if not out_name.endswith(".txt"):
        out_name += ".txt"

    out_path = os.path.join(raw_dir, out_name)

    # --- Combine ---
    with open(out_path, "w", encoding="utf-8") as out_file:
        for i, (key, fname) in enumerate(selected_chapters):
            src_path = os.path.join(version_dir, fname)
            with open(src_path, "r", encoding="utf-8") as f:
                content = f.read().rstrip()
            out_file.write(content)
            if i < len(selected_chapters) - 1:
                out_file.write("\n\n\n")  # three blank lines between chapters

    print(f"\nDone. Combined file saved to:\n  {out_path}")
    input("\nPress Enter to close.")


if __name__ == "__main__":
    main()
